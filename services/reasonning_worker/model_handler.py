from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import openvino as ov
import openvino_genai as ov_genai
import requests
from sumy.nlp.tokenizers import Tokenizer
from sumy.parsers.plaintext import PlaintextParser
from sumy.summarizers.lsa import LsaSummarizer

from file_handler import load_rgb_image
from image_analizer import analyze_flood_mask
from db_handler import MASK_SOURCE_COLUMNS, STATUS_COLUMN, TABLE_NAME, VLM_OUTPUT_COLUMN, get_data, update_data

MODEL_PATH = "./qwen2-quant"
MODEL_DEVICE = "CPU"

job_status: Dict[str, Dict[str, Any]] = {}
conversation_store: Dict[str, "ConversationMem"] = {}

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


@dataclass
class ConversationMem:
    turns: list[dict[str, str]] = field(default_factory=list)
    lsa_summarizer: LsaSummarizer = field(default_factory=LsaSummarizer, init=False, repr=False)

    def add(self, user: str, assistant: str) -> None:
        self.turns.append({"user": user, "assistant": assistant})

    def clear(self) -> None:
        self.turns.clear()

    def to_serializable(self) -> list[dict[str, str]]:
        return list(self.turns)

    def to_session_history(self) -> list[dict[str, str]]:
        serialized: list[dict[str, str]] = []
        for turn in self.turns:
            timestamp = datetime.now(timezone.utc).isoformat()
            serialized.append(
                {
                    "role": "user",
                    "content": turn["user"],
                    "createdAt": timestamp,
                }
            )
            serialized.append(
                {
                    "role": "assistant",
                    "content": turn["assistant"],
                    "createdAt": timestamp,
                }
            )
        return serialized

    @staticmethod
    def _count_sentences(paragraph: str) -> int:
        sentences = [s.strip() for s in paragraph.split(".") if s.strip()]
        return len(sentences)

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

        summarized_history = []
        for turn in self.turns:
            summarized_history.append(
                {
                    "user": self._summarize_text(turn["user"]),
                    "assistant": self._summarize_text(turn["assistant"]),
                }
            )
        return summarized_history

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
    id: str  # job_id
    session_id: str
    task_name: str
    image_source: str
    mask_source: str
    image_tensor: ov.Tensor
    mask_stats: Dict[str, Any]
    conversation: ConversationMem
    context: str


def _resolve_mask_source(row: Dict[str, Any]) -> Optional[str]:

    for column in MASK_SOURCE_COLUMNS:
        value = row.get(column)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _road_prompt() -> tuple[list[int], str]:
    colors = [0, 0, 255]
    description = "Road segments that are visibly inundated or impassable."
    return colors, description


def _building_prompt() -> tuple[list[int], str]:
    colors = [255, 0, 0]
    description = "Residential or building footprints that are inundated."
    return colors, description


def build_context_prompt(
    task_name: str,
    image_source: str,
    mask_source: str,
    mask_stats: dict[str, Any],
    history_summary: str = ""
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
        "If required information is missing, say 'insufficient evidence'.",
        "For recommendations, prioritize civilian safety, access routes, and critical supplies.",
    ]

    return (
        "FLOOD_CONTEXT_PROMPT\n"
        + json.dumps(context_obj, ensure_ascii=False, indent=2)
        + "\nRESPONSE_GUIDELINES\n- "
        + "\n- ".join(instructions)
    )


def build_generation_config(
    max_new_tokens: int = 260,
    temperature: float = 0.2,
    top_p: float = 0.9,
) -> ov_genai.GenerationConfig:
    generation_config = ov_genai.GenerationConfig()
    generation_config.max_new_tokens = max_new_tokens
    generation_config.do_sample = True
    generation_config.temperature = temperature
    generation_config.top_p = top_p
    generation_config.top_k = 40
    generation_config.repetition_penalty = 1.15
    generation_config.frequency_penalty = 0.2
    generation_config.presence_penalty = 0.1
    generation_config.no_repeat_ngram_size = 4
    return generation_config


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


def load_model() -> Optional[ov_genai.VLMPipeline]:
    return ov_genai.VLMPipeline(MODEL_PATH, MODEL_DEVICE)


def send_vlm_callback(callback_url: str, payload: dict[str, Any]) -> None:
    if not callback_url:
        return
    try:
        response = requests.post(callback_url, json=payload, timeout=15)
        response.raise_for_status()
    except Exception as exc:
        print(f"⚠️ Failed to send VLM callback: {exc}")


def start_session(
    id: str,
    session_id: str,
    task_name: str,
    image_source: str,
    mask_source: str,
    conversation: ConversationMem
) -> SessionState:
    image_array = load_rgb_image(image_source)
    image_tensor = ov.Tensor(image_array)

    try:
        mask_stats = analyze_flood_mask(mask_source)
    except Exception as exc:
        mask_stats = {"error": f"Failed to parse mask metrics: {exc}"}

    context = build_context_prompt(
        task_name=task_name,
        image_source=image_source,
        mask_source=mask_source,
        mask_stats=mask_stats,
        history_summary=conversation.pretty()
    )

    from db_handler import upsert_session
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
        image_tensor=image_tensor,
        mask_stats=mask_stats,
        conversation=conversation,
        context=context,
    )


def extract_text(result: Any) -> str:
    if hasattr(result, "texts") and result.texts:
        return str(result.texts[0]).strip()
    return str(result).strip()


def return_response(
    pipe: ov_genai.VLMPipeline,
    generation_config: ov_genai.GenerationConfig,
    initial_state: SessionState,
    memory: ConversationMem,
    question: str = "",
    streaming: bool = False,
) -> str:
    raw_question = (question or "").strip()
    is_first_turn = len(memory.turns) == 0

    if is_first_turn:
        question_block = FIRST_TURN_PROMPT
        stored_user_text = "FIRST_TURN_PROMPT"
    else:
        question_block = raw_question or "Please provide a concise follow-up flood update."
        stored_user_text = raw_question or "(empty follow-up question)"

    prompt = (
        f"|im_start| system\n{FLOOD_REASONING_SYSTEM_PROMPT}|im_end|\n"
        f"|im_start| system\n{initial_state.context}|im_end|\n"
        "<|vision_start|><|image_pad|><|vision_end|>\n"
        "<|im_start|>user\n"
        f"{question_block}\n"
        "Answer concisely, grounded in the metrics, and explicitly state uncertainty when needed.\n"
        "Do not repeat section titles or duplicate sentences.\n"
        "<|im_end|>\n"
        "<|im_start|>assistant\n"
    )

    streamed_chunks: list[str] = []
    if streaming:
        def _streamer(chunk: str) -> bool:
            candidate = "".join(streamed_chunks) + chunk
            if _looks_repetitive(candidate):
                return True
            streamed_chunks.append(chunk)
            return False

        text_streamer = ov_genai.TextStreamer(pipe.get_tokenizer(), _streamer)
        result = pipe.generate(
            prompt,
            image=initial_state.image_tensor,
            generation_config=generation_config,
            streamer=text_streamer,
        )
        text_streamer.end()
        answer = "".join(streamed_chunks).strip() or extract_text(result)
    else:
        result = pipe.generate(
            prompt,
            image=initial_state.image_tensor,
            generation_config=generation_config,
        )
        answer = extract_text(result)

    memory.add(stored_user_text, answer)
    from db_handler import upsert_session
    upsert_session(
        initial_state.session_id,
        initial_state.id,
        {
            "task_name": initial_state.task_name,
            "image_source": initial_state.image_source,
            "mask_source": initial_state.mask_source,
            "mask_metrics": initial_state.mask_stats,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        },
        memory.to_session_history(),
    )
    return answer


def run_reasoning_task(
    pipe: ov_genai.VLMPipeline,
    generation_config: ov_genai.GenerationConfig,
    job_id: str,
    session_id: str = "",
    question: str = "",
    callback_url: str = "",
    streaming: bool = False,
) -> Optional[str]:
    # Use job_id if session_id is empty
    actual_session_id = session_id or job_id
    data = get_data(job_id)
    normalized_question = (question or "").strip()
    logged_question = normalized_question or "FIRST_TURN_PROMPT"

    try:
        job_status[job_id] = {
            "status": "processing(vlm)",
            "start_time": time.time(),
            "question": logged_question,
        }
        update_data(STATUS_COLUMN, "processing(vlm)", TABLE_NAME, "job_id", job_id)

        if not data:
            error_msg = "job_id not found in database"
            job_status[job_id].update({"status": "error", "error": error_msg})
            update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
            update_data("error_code", "VLM_JOB_NOT_FOUND", TABLE_NAME, "job_id", job_id)
            update_data("error_message", error_msg, TABLE_NAME, "job_id", job_id)
            send_vlm_callback(
                callback_url,
                {
                    "job_id": job_id,
                    "session_id": actual_session_id,
                    "status": "error",
                    "error_code": "VLM_JOB_NOT_FOUND",
                    "error_message": error_msg,
                },
            )
            return None

        row = data[0]
        image_source = row.get("image_url") or row.get("url_image")
        mask_source = _resolve_mask_source(row)

        if not image_source:
            error_msg = "Image URL not found for this job_id"
            job_status[job_id].update({"status": "error", "error": error_msg})
            update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
            update_data("error_code", "VLM_IMAGE_URL_MISSING", TABLE_NAME, "job_id", job_id)
            update_data("error_message", error_msg, TABLE_NAME, "job_id", job_id)
            send_vlm_callback(
                callback_url,
                {
                    "job_id": job_id,
                    "session_id": actual_session_id,
                    "status": "error",
                    "error_code": "VLM_IMAGE_URL_MISSING",
                    "error_message": error_msg,
                },
            )
            return None

        if not mask_source:
            error_msg = "Mask URL not found for this job_id"
            job_status[job_id].update({"status": "error", "error": error_msg})
            update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
            update_data("error_code", "VLM_MASK_URL_MISSING", TABLE_NAME, "job_id", job_id)
            update_data("error_message", error_msg, TABLE_NAME, "job_id", job_id)
            send_vlm_callback(
                callback_url,
                {
                    "job_id": job_id,
                    "session_id": actual_session_id,
                    "status": "error",
                    "error_code": "VLM_MASK_URL_MISSING",
                    "error_message": error_msg,
                },
            )
            return None

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
            pipe=pipe,
            generation_config=generation_config,
            initial_state=session,
            memory=memory,
            question=normalized_question,
            streaming=streaming,
        )

        end_time = time.time()
        job_status[job_id].update(
            {
                "status": "success(vlm)",
                "answer": answer,
                "image_source": image_source,
                "mask_source": mask_source,
                "end_time": end_time,
                "duration": end_time - job_status[job_id]["start_time"],
            }
        )

        update_data(VLM_OUTPUT_COLUMN, answer, TABLE_NAME, "job_id", job_id)
        update_data(STATUS_COLUMN, "success(vlm)", TABLE_NAME, "job_id", job_id)
        update_data("error_code", None, TABLE_NAME, "job_id", job_id)
        update_data("error_message", None, TABLE_NAME, "job_id", job_id)
        send_vlm_callback(
            callback_url,
            {
                "job_id": job_id,
                "session_id": actual_session_id,
                "status": "success(vlm)",
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

    except Exception as exc:
        error_time = time.time()
        if job_id not in job_status:
            job_status[job_id] = {"start_time": error_time}
        job_status[job_id].update({"status": "error", "error": str(exc), "end_time": error_time})
        if "start_time" in job_status[job_id]:
            job_status[job_id]["duration"] = error_time - job_status[job_id]["start_time"]
        update_data(STATUS_COLUMN, "error", TABLE_NAME, "job_id", job_id)
        update_data("error_code", "VLM_INTERNAL_ERROR", TABLE_NAME, "job_id", job_id)
        update_data("error_message", str(exc), TABLE_NAME, "job_id", job_id)
        send_vlm_callback(
            callback_url,
            {
                "job_id": job_id,
                "session_id": actual_session_id,
                "status": "error",
                "error_code": "VLM_INTERNAL_ERROR",
                "error_message": str(exc),
            },
        )
        return None
