from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import requests
from dotenv import load_dotenv
from sumy.nlp.tokenizers import Tokenizer
from sumy.parsers.plaintext import PlaintextParser
from sumy.summarizers.lsa import LsaSummarizer

try:
    from FloodAI.services.reasoning_worker.db_handler import (
        MASK_SOURCE_COLUMNS,
        STATUS_COLUMN,
        TABLE_NAME,
        VLM_OUTPUT_COLUMN,
        get_data,
        update_data,
        upsert_session,
    )
    from FloodAI.services.reasoning_worker.file_handler import encode_image_base64
    from FloodAI.services.reasoning_worker.image_analizer import analyze_flood_mask
except Exception:
    from .db_handler import (
        MASK_SOURCE_COLUMNS,
        STATUS_COLUMN,
        TABLE_NAME,
        VLM_OUTPUT_COLUMN,
        get_data,
        update_data,
        upsert_session,
    )
    from .file_handler import encode_image_base64
    from .image_analizer import analyze_flood_mask

load_dotenv()

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:e2b-it-q4_K_M")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "120"))
OLLAMA_MAX_CONCURRENCY = max(1, int(os.getenv("OLLAMA_MAX_CONCURRENCY", "2")))
OLLAMA_RETRY_ATTEMPTS = max(1, int(os.getenv("OLLAMA_RETRY_ATTEMPTS", "3")))
OLLAMA_RETRY_BACKOFF_SECONDS = float(os.getenv("OLLAMA_RETRY_BACKOFF_SECONDS", "5"))
OLLAMA_FALLBACK_TIMEOUT = int(os.getenv("OLLAMA_FALLBACK_TIMEOUT_SECONDS", "45"))
OLLAMA_FALLBACK_NUM_PREDICT = int(os.getenv("OLLAMA_FALLBACK_NUM_PREDICT", "160"))
PROCESSING_VLM_STATUS = "processing_vlm"
SUCCESS_VLM_STATUS = "success_vlm"

job_status: Dict[str, Dict[str, Any]] = {}
conversation_store: Dict[str, "ConversationMem"] = {}
_request_slots = threading.BoundedSemaphore(OLLAMA_MAX_CONCURRENCY)

FLOOD_REASONING_SYSTEM_PROMPT = (
    "You are a vision reasoning assistant specialized in flood assessment.\n"
    "Goals:\n"
    "1. Answer flood-related questions using image evidence and mask metrics.\n"
    "2. Prioritize human safety, access routes for response, and infrastructure impact.\n"
    "Rules:\n"
    "1. Do not invent numbers. Coverage percentages must follow the provided metrics.\n"
    "2. Clearly separate [Observation] / [Inference] / [Uncertainty].\n"
    "3. If evidence is missing, explicitly state what is unknown.\n"
    "4. Do not claim water depth, casualties, or structural collapse without direct evidence.\n"
    "5. Keep responses concise and practical.\n"
)

FIRST_TURN_PROMPT = (
    "Give me:\n"
    "1) Flood situation overview\n"
    "2) Transport and infrastructure impact\n"
    "3) Residential impact\n"
    "4) Immediate priority actions\n"
    "5) Confidence and uncertainty\n"
    "Each section should be 1-2 short sentences.\n"
    "Use each numbered heading exactly once.\n"
    "Do not repeat any heading or sentence.\n"
)


class OllamaClientError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ConversationMem:
    turns: list[dict[str, str]] = field(default_factory=list)
    lsa_summarizer: LsaSummarizer = field(default_factory=LsaSummarizer, init=False, repr=False)

    def add(self, user: str, assistant: str) -> None:
        self.turns.append({"user": user, "assistant": assistant})

    def clear(self) -> None:
        self.turns.clear()

    def to_session_history(self) -> list[dict[str, str]]:
        serialized: list[dict[str, str]] = []
        for turn in self.turns:
            timestamp = datetime.now(timezone.utc).isoformat()
            serialized.append({"role": "user", "content": turn["user"], "createdAt": timestamp})
            serialized.append(
                {"role": "assistant", "content": turn["assistant"], "createdAt": timestamp}
            )
        return serialized

    @staticmethod
    def _count_sentences(paragraph: str) -> int:
        return len([s.strip() for s in paragraph.split(".") if s.strip()])

    def _summarize_text(self, text: str) -> str:
        cleaned = text.strip()
        if not cleaned:
            return ""

        sentence_count = self._count_sentences(cleaned)
        if sentence_count <= 1:
            return cleaned

        target_count = sentence_count // 2 if sentence_count > 5 else max(1, sentence_count - 1)
        try:
            parser = PlaintextParser.from_string(cleaned, Tokenizer("english"))
            summary_sentences = self.lsa_summarizer(parser.document, target_count)
            summary_text = " ".join(str(sentence) for sentence in summary_sentences).strip()
            return summary_text or cleaned
        except Exception:
            return cleaned

    def summary_conversation(self) -> list[dict[str, str]]:
        if not self.turns:
            return []
        return [
            {
                "user": self._summarize_text(turn["user"]),
                "assistant": self._summarize_text(turn["assistant"]),
            }
            for turn in self.turns
        ]

    def pretty(self) -> str:
        if not self.turns:
            return ""
        lines: list[str] = []
        for idx, turn in enumerate(self.summary_conversation(), start=1):
            lines.append(f"[Turn {idx}] USER: {turn['user']}")
            lines.append(f"[Turn {idx}] ASSISTANT: {turn['assistant']}")
        return "\n".join(lines)


@dataclass
class SessionState:
    id: str
    session_id: str
    task_name: str
    image_source: str
    mask_source: str
    image_b64: str
    mask_b64: str
    mask_stats: Dict[str, Any]
    conversation: ConversationMem
    context: str


@dataclass
class OllamaClient:
    base_url: str
    model: str
    timeout: int
    session: requests.Session = field(default_factory=requests.Session)

    @staticmethod
    def _is_model_loading_response(status_code: int, body: str) -> bool:
        return status_code >= 500 and "loading model" in body.lower()

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: Optional[Exception] = None
        for attempt in range(1, OLLAMA_RETRY_ATTEMPTS + 1):
            try:
                response = self.session.post(
                    f"{self.base_url}{path}",
                    json=payload,
                    timeout=self.timeout,
                )
            except requests.Timeout as exc:
                raise OllamaClientError("OLLAMA_TIMEOUT", f"Ollama timed out after {self.timeout}s.") from exc
            except requests.RequestException as exc:
                raise OllamaClientError("OLLAMA_CONNECTION_ERROR", f"Failed to reach Ollama: {exc}") from exc

            if response.status_code == 404:
                raise OllamaClientError(
                    "OLLAMA_MODEL_NOT_FOUND",
                    f"Model '{self.model}' was not found in Ollama.",
                )

            if self._is_model_loading_response(response.status_code, response.text):
                last_error = OllamaClientError(
                    "OLLAMA_MODEL_LOADING",
                    f"Ollama is still loading model '{self.model}'.",
                )
                if attempt < OLLAMA_RETRY_ATTEMPTS:
                    time.sleep(OLLAMA_RETRY_BACKOFF_SECONDS)
                    continue
                raise last_error

            if response.status_code >= 400:
                raise OllamaClientError(
                    "OLLAMA_HTTP_ERROR",
                    f"Ollama returned HTTP {response.status_code}: {response.text}",
                )

            try:
                return response.json()
            except ValueError as exc:
                raise OllamaClientError("OLLAMA_INVALID_JSON", "Ollama returned invalid JSON.") from exc

        if last_error is not None:
            raise last_error
        raise OllamaClientError("OLLAMA_HTTP_ERROR", "Ollama request failed without a response.")

    def probe(self) -> dict[str, Any]:
        try:
            response = self.session.get(f"{self.base_url}/api/tags", timeout=min(self.timeout, 15))
            response.raise_for_status()
            tags = response.json().get("models", [])
        except requests.RequestException as exc:
            raise OllamaClientError("OLLAMA_CONNECTION_ERROR", f"Failed to reach Ollama: {exc}") from exc
        except ValueError as exc:
            raise OllamaClientError("OLLAMA_INVALID_JSON", "Ollama /api/tags returned invalid JSON.") from exc

        available_models = {
            item.get("model") or item.get("name")
            for item in tags
            if isinstance(item, dict)
        }
        if self.model not in available_models:
            raise OllamaClientError(
                "OLLAMA_MODEL_NOT_FOUND",
                f"Model '{self.model}' is not available in /api/tags.",
            )
        return {"model": self.model, "available": True}

    def chat(self, messages: list[dict[str, Any]], options: dict[str, Any]) -> str:
        payload = {"model": self.model, "messages": messages, "stream": False, "options": options}
        data = self._post("/api/chat", payload)
        content = ((data.get("message") or {}).get("content") or "").strip()
        if not content:
            raise OllamaClientError("OLLAMA_EMPTY_RESPONSE", "Ollama returned an empty response.")
        return content

    def with_timeout(self, timeout: int) -> "OllamaClient":
        return OllamaClient(self.base_url, self.model, timeout, self.session)


def _resolve_mask_source(row: Dict[str, Any]) -> Optional[str]:
    for column in MASK_SOURCE_COLUMNS:
        value = row.get(column)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _road_prompt() -> tuple[list[int], str]:
    return [0, 0, 255], "Road segments that are visibly inundated or impassable."


def _building_prompt() -> tuple[list[int], str]:
    return [255, 0, 0], "Residential or building footprints that are inundated."


def build_context_prompt(
    task_name: str,
    image_source: str,
    mask_source: str,
    mask_stats: dict[str, Any],
    history_summary: str = "",
) -> str:
    road_colors, road_desc = _road_prompt()
    building_colors, building_desc = _building_prompt()

    context_obj: dict[str, Any] = {
        "scene_context": {
            "image_source": image_source,
            "mask_source": mask_source,
            "task": task_name,
        },
        "label_legend": {
            "flooded_road": {"rgb": road_colors, "description": road_desc},
            "flooded_house": {"rgb": building_colors, "description": building_desc},
        },
        "authoritative_mask_metrics": mask_stats,
    }
    if history_summary:
        context_obj["conversation_history"] = history_summary

    instructions = [
        "Use the provided metrics as the primary quantitative evidence.",
        "Use visual evidence for scene description, not as a replacement for metrics.",
        "The attached images are ordered as: original scene image, segmentation overlay mask.",
        "Use the mask overlay only as an attention guide for flooded roads/buildings.",
        "If required information is missing, say 'insufficient evidence'.",
        "For recommendations, prioritize civilian safety, access routes, and critical supplies.",
    ]

    return (
        "FLOOD_CONTEXT_PROMPT\n"
        + json.dumps(context_obj, ensure_ascii=False, indent=2)
        + "\nRESPONSE_GUIDELINES\n- "
        + "\n- ".join(instructions)
    )


def build_generation_config() -> dict[str, Any]:
    return {
        "num_predict": int(os.getenv("OLLAMA_NUM_PREDICT", "260")),
        "temperature": float(os.getenv("OLLAMA_TEMPERATURE", "0.2")),
        "top_p": float(os.getenv("OLLAMA_TOP_P", "0.9")),
        "top_k": int(os.getenv("OLLAMA_TOP_K", "40")),
        "repeat_penalty": float(os.getenv("OLLAMA_REPEAT_PENALTY", "1.15")),
    }


def build_fallback_generation_config(base_config: dict[str, Any]) -> dict[str, Any]:
    fallback_config = dict(base_config)
    fallback_config["num_predict"] = min(
        int(fallback_config.get("num_predict", OLLAMA_FALLBACK_NUM_PREDICT)),
        OLLAMA_FALLBACK_NUM_PREDICT,
    )
    return fallback_config


def _looks_repetitive(text: str) -> bool:
    words = text.lower().split()
    if len(words) < 70:
        return False

    tail = words[-90:]
    unique_ratio = len(set(tail)) / len(tail)
    if unique_ratio < 0.35:
        return True

    if len(tail) >= 24:
        first = " ".join(tail[-24:-12])
        second = " ".join(tail[-12:])
        if first == second:
            return True

    return False


def load_model() -> Optional[OllamaClient]:
    client = OllamaClient(OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT)
    try:
        client.probe()
    except OllamaClientError as exc:
        print(f"Ollama model probe failed: {exc.code} - {exc}")
        return None
    return client


def send_vlm_callback(callback_url: str, payload: dict[str, Any]) -> None:
    if not callback_url:
        return
    try:
        response = requests.post(callback_url, json=payload, timeout=15)
        response.raise_for_status()
    except Exception as exc:
        print(f"Failed to send VLM callback: {exc}")


def _record_error(
    job_id: str,
    session_id: str,
    callback_url: str,
    error_code: str,
    error_message: str,
) -> None:
    if job_id not in job_status:
        job_status[job_id] = {}
    job_status[job_id].update({"status": "error", "error": error_message})
    update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
    update_data("error_code", error_code, TABLE_NAME, "job_id", job_id)
    update_data("error_message", error_message, TABLE_NAME, "job_id", job_id)
    send_vlm_callback(
        callback_url,
        {
            "job_id": job_id,
            "session_id": session_id,
            "status": "error",
            "error_code": error_code,
            "error_message": error_message,
        },
    )


def start_session(
    id: str,
    session_id: str,
    task_name: str,
    image_source: str,
    mask_source: str,
    conversation: ConversationMem,
) -> SessionState:
    image_b64 = encode_image_base64(image_source)
    mask_b64 = encode_image_base64(mask_source)

    try:
        mask_stats = analyze_flood_mask(mask_source)
    except Exception as exc:
        mask_stats = {"error": f"Failed to parse mask metrics: {exc}"}

    context = build_context_prompt(
        task_name=task_name,
        image_source=image_source,
        mask_source=mask_source,
        mask_stats=mask_stats,
        history_summary=conversation.pretty(),
    )

    upsert_session(
        session_id,
        id,
        {
            "task_name": task_name,
            "image_source": image_source,
            "mask_source": mask_source,
            "mask_metrics": mask_stats,
            "history_summary": conversation.pretty(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
        conversation.to_session_history(),
    )

    return SessionState(
        id=id,
        session_id=session_id,
        task_name=task_name,
        image_source=image_source,
        mask_source=mask_source,
        image_b64=image_b64,
        mask_b64=mask_b64,
        mask_stats=mask_stats,
        conversation=conversation,
        context=context,
    )


def _build_user_prompt(initial_state: SessionState, question: str, is_first_turn: bool) -> tuple[str, str]:
    raw_question = (question or "").strip()
    if is_first_turn:
        question_block = FIRST_TURN_PROMPT
        stored_user_text = "FIRST_TURN_PROMPT"
    else:
        question_block = raw_question or "Please provide a concise follow-up flood update."
        stored_user_text = raw_question or "(empty follow-up question)"

    prompt = (
        f"{initial_state.context}\n\n"
        "TASK\n"
        f"{question_block}\n\n"
        "VISUAL_INPUT_RULES\n"
        "- Image 1 is the original scene.\n"
        "- Image 2 is the segmentation overlay mask.\n"
        "- Use Image 2 only to focus attention on highlighted flooded regions.\n"
        "- Do not mistake mask colors for natural scene colors.\n"
        "- Answer concisely, grounded in the metrics, and explicitly state uncertainty when needed.\n"
        "- Do not repeat section titles or duplicate sentences.\n"
    )
    return prompt, stored_user_text


def _build_multimodal_messages(initial_state: SessionState, prompt: str) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": FLOOD_REASONING_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": prompt,
            "images": [initial_state.image_b64, initial_state.mask_b64],
        },
    ]


def _build_text_fallback_messages(
    initial_state: SessionState,
    prompt: str,
    fallback_reason: str,
) -> list[dict[str, Any]]:
    fallback_content = (
        f"{prompt}\n\n"
        "FALLBACK_MODE\n"
        f"- Multimodal generation failed: {fallback_reason}\n"
        "- Reason only from the authoritative mask metrics and context above.\n"
        "- You may mention that the visual reasoning path was unavailable.\n"
    )
    return [
        {"role": "system", "content": FLOOD_REASONING_SYSTEM_PROMPT},
        {"role": "user", "content": fallback_content},
    ]


def return_response(
    client: OllamaClient,
    generation_config: dict[str, Any],
    initial_state: SessionState,
    memory: ConversationMem,
    question: str = "",
) -> str:
    is_first_turn = len(memory.turns) == 0
    prompt, stored_user_text = _build_user_prompt(initial_state, question, is_first_turn)
    fallback_reason = ""
    fallback_client = client.with_timeout(OLLAMA_FALLBACK_TIMEOUT)
    fallback_generation_config = build_fallback_generation_config(generation_config)

    try:
        answer = client.chat(_build_multimodal_messages(initial_state, prompt), generation_config)
    except OllamaClientError as exc:
        if exc.code in {
            "OLLAMA_CONNECTION_ERROR",
            "OLLAMA_MODEL_NOT_FOUND",
            "OLLAMA_TIMEOUT",
        }:
            raise
        fallback_reason = f"{exc.code}: {exc}"
        answer = fallback_client.chat(
            _build_text_fallback_messages(initial_state, prompt, fallback_reason),
            fallback_generation_config,
        )

    if _looks_repetitive(answer):
        raise OllamaClientError("OLLAMA_REPETITIVE_RESPONSE", "Model response became repetitive.")

    memory.add(stored_user_text, answer)
    upsert_session(
        initial_state.session_id,
        initial_state.id,
        {
            "task_name": initial_state.task_name,
            "image_source": initial_state.image_source,
            "mask_source": initial_state.mask_source,
            "mask_metrics": initial_state.mask_stats,
            "fallback_reason": fallback_reason or None,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
        memory.to_session_history(),
    )
    return answer


def run_reasoning_task(
    client: OllamaClient,
    generation_config: dict[str, Any],
    job_id: str,
    session_id: str = "",
    question: str = "",
    callback_url: str = "",
    streaming: bool = False,
) -> Optional[str]:
    del streaming
    actual_session_id = session_id or job_id
    data = get_data(job_id)
    normalized_question = (question or "").strip()
    logged_question = normalized_question or "FIRST_TURN_PROMPT"

    try:
        job_status[job_id] = {
            "status": PROCESSING_VLM_STATUS,
            "start_time": time.time(),
            "question": logged_question,
        }
        update_data(STATUS_COLUMN, PROCESSING_VLM_STATUS, TABLE_NAME, "job_id", job_id)

        if not data:
            error_msg = "job_id not found in database"
            _record_error(
                job_id,
                actual_session_id,
                callback_url,
                "VLM_JOB_NOT_FOUND",
                error_msg,
            )
            return None

        row = data[0]
        image_source = row.get("image_url") or row.get("url_image")
        mask_source = _resolve_mask_source(row)

        if not image_source:
            error_msg = "Image URL not found for this job_id"
            _record_error(
                job_id,
                actual_session_id,
                callback_url,
                "VLM_IMAGE_URL_MISSING",
                error_msg,
            )
            return None

        if not mask_source:
            error_msg = "Mask URL not found for this job_id"
            _record_error(
                job_id,
                actual_session_id,
                callback_url,
                "VLM_MASK_URL_MISSING",
                error_msg,
            )
            return None

        with _request_slots:
            memory = conversation_store.setdefault(actual_session_id, ConversationMem())
            session = start_session(
                id=job_id,
                session_id=actual_session_id,
                task_name="flood_reasoning",
                image_source=image_source,
                mask_source=mask_source,
                conversation=memory,
            )
            answer = return_response(
                client=client,
                generation_config=generation_config,
                initial_state=session,
                memory=memory,
                question=normalized_question,
            )

        end_time = time.time()
        job_status[job_id].update(
            {
                "status": SUCCESS_VLM_STATUS,
                "answer": answer,
                "image_source": image_source,
                "mask_source": mask_source,
                "end_time": end_time,
                "duration": end_time - job_status[job_id]["start_time"],
            }
        )

        update_data(VLM_OUTPUT_COLUMN, answer, TABLE_NAME, "job_id", job_id)
        update_data(STATUS_COLUMN, SUCCESS_VLM_STATUS, TABLE_NAME, "job_id", job_id)
        update_data("error_code", None, TABLE_NAME, "job_id", job_id)
        update_data("error_message", None, TABLE_NAME, "job_id", job_id)
        send_vlm_callback(
            callback_url,
            {
                "job_id": job_id,
                "session_id": actual_session_id,
                "status": SUCCESS_VLM_STATUS,
                "reply": answer,
                "context": {
                    "image_source": image_source,
                    "mask_source": mask_source,
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                },
                "history": memory.to_session_history(),
            },
        )
        return answer

    except OllamaClientError as exc:
        error_code = exc.code
        error_message = str(exc)
    except Exception as exc:
        error_code = "VLM_INTERNAL_ERROR"
        error_message = str(exc)

    error_time = time.time()
    if job_id not in job_status:
        job_status[job_id] = {"start_time": error_time}
    job_status[job_id].update({"status": "error", "error": error_message, "end_time": error_time})
    if "start_time" in job_status[job_id]:
        job_status[job_id]["duration"] = error_time - job_status[job_id]["start_time"]
    _record_error(job_id, actual_session_id, callback_url, error_code, error_message)
    job_status[job_id]["end_time"] = error_time
    if "start_time" in job_status[job_id]:
        job_status[job_id]["duration"] = error_time - job_status[job_id]["start_time"]
    return None
