from __future__ import annotations

import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]


def install_model_handler_stubs() -> None:
    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = dotenv

    supabase = types.ModuleType("supabase")
    supabase.Client = object
    supabase.create_client = lambda *args, **kwargs: object()
    sys.modules["supabase"] = supabase

    requests = types.ModuleType("requests")

    class Session:
        def post(self, *_args, **_kwargs):
            raise AssertionError("network should be mocked in tests")

        def get(self, *_args, **_kwargs):
            raise AssertionError("network should be mocked in tests")

    class Timeout(Exception):
        pass

    class RequestException(Exception):
        pass

    requests.Session = Session
    requests.Timeout = Timeout
    requests.RequestException = RequestException
    requests.post = lambda *args, **kwargs: None
    sys.modules["requests"] = requests

    sumy = types.ModuleType("sumy")
    sys.modules["sumy"] = sumy

    sumy_nlp = types.ModuleType("sumy.nlp")
    sys.modules["sumy.nlp"] = sumy_nlp
    tokenizers = types.ModuleType("sumy.nlp.tokenizers")
    tokenizers.Tokenizer = lambda *_args, **_kwargs: object()
    sys.modules["sumy.nlp.tokenizers"] = tokenizers

    parsers = types.ModuleType("sumy.parsers")
    sys.modules["sumy.parsers"] = parsers
    plaintext = types.ModuleType("sumy.parsers.plaintext")

    class PlaintextParser:
        @staticmethod
        def from_string(text, _tokenizer):
            return types.SimpleNamespace(document=text)

    plaintext.PlaintextParser = PlaintextParser
    sys.modules["sumy.parsers.plaintext"] = plaintext

    summarizers = types.ModuleType("sumy.summarizers")
    sys.modules["sumy.summarizers"] = summarizers
    lsa = types.ModuleType("sumy.summarizers.lsa")

    class LsaSummarizer:
        def __call__(self, _document, _target_count):
            return []

    lsa.LsaSummarizer = LsaSummarizer
    sys.modules["sumy.summarizers.lsa"] = lsa

    file_handler = types.ModuleType("services.reasoning_worker.file_handler")
    file_handler.encode_image_base64 = lambda _source: "encoded"
    sys.modules["services.reasoning_worker.file_handler"] = file_handler

    image_analizer = types.ModuleType("services.reasoning_worker.image_analizer")
    image_analizer.analyze_flood_mask = lambda _source: {
      "flooded_road_pct_of_image": 10.5
    }
    sys.modules["services.reasoning_worker.image_analizer"] = image_analizer

    db_handler = types.ModuleType("services.reasoning_worker.db_handler")
    db_handler.MASK_SOURCE_COLUMNS = ["mask_url"]
    db_handler.STATUS_COLUMN = "status"
    db_handler.TABLE_NAME = "task_reasoning"
    db_handler.VLM_OUTPUT_COLUMN = "vlm_analysis"
    db_handler.get_data = lambda _job_id: []
    db_handler.update_data = lambda *args, **kwargs: None
    db_handler.upsert_session = lambda *args, **kwargs: None
    sys.modules["services.reasoning_worker.db_handler"] = db_handler


class ModelHandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        install_model_handler_stubs()
        sys.path.insert(0, str(REPO_ROOT))

    def setUp(self):
        sys.modules.pop("services.reasoning_worker.model_handler", None)
        self.model_handler = importlib.import_module(
            "services.reasoning_worker.model_handler"
        )

    def test_build_generation_config_contains_expected_keys(self):
        config = self.model_handler.build_generation_config()
        self.assertIn("num_predict", config)
        self.assertIn("temperature", config)
        self.assertIn("top_p", config)

    def test_multimodal_messages_include_original_and_mask(self):
        state = self.model_handler.SessionState(
            id="job-1",
            session_id="session-1",
            task_name="flood_reasoning",
            image_source="image-url",
            mask_source="mask-url",
            image_b64="image-b64",
            mask_b64="mask-b64",
            mask_stats={"flooded_road_pct_of_image": 10.5},
            conversation=self.model_handler.ConversationMem(),
            context="CTX",
        )

        prompt, _ = self.model_handler._build_user_prompt(
            state,
            "What is happening?",
            False,
        )
        messages = self.model_handler._build_multimodal_messages(state, prompt)
        self.assertEqual(messages[1]["images"], ["image-b64", "mask-b64"])

    def test_return_response_falls_back_to_text_reasoning(self):
        memory = self.model_handler.ConversationMem()
        state = self.model_handler.SessionState(
            id="job-1",
            session_id="session-1",
            task_name="flood_reasoning",
            image_source="image-url",
            mask_source="mask-url",
            image_b64="image-b64",
            mask_b64="mask-b64",
            mask_stats={"flooded_road_pct_of_image": 10.5},
            conversation=memory,
            context="CTX",
        )
        client = self.model_handler.OllamaClient(
            "http://localhost:11434",
            "gemma4:e2b-it-q4_K_M",
            10,
        )
        fallback_client = self.model_handler.OllamaClient(
            "http://localhost:11434",
            "gemma4:e2b-it-q4_K_M",
            5,
        )

        with patch.object(
            self.model_handler,
            "upsert_session",
        ) as mock_upsert, patch.object(
            client,
            "with_timeout",
            return_value=fallback_client,
        ) as mock_with_timeout, patch.object(
            client,
            "chat",
            side_effect=[
                self.model_handler.OllamaClientError(
                    "OLLAMA_HTTP_ERROR",
                    "vision failed",
                )
            ],
        ), patch.object(
            fallback_client,
            "chat",
            return_value="Fallback answer from metrics.",
        ) as mock_fallback_chat:
            answer = self.model_handler.return_response(
                client=client,
                generation_config=self.model_handler.build_generation_config(),
                initial_state=state,
                memory=memory,
                question="",
            )

        self.assertEqual(answer, "Fallback answer from metrics.")
        self.assertEqual(len(memory.turns), 1)
        mock_with_timeout.assert_called_once()
        mock_fallback_chat.assert_called_once()
        mock_upsert.assert_called()

    def test_return_response_does_not_fallback_on_timeout(self):
        memory = self.model_handler.ConversationMem()
        state = self.model_handler.SessionState(
            id="job-1",
            session_id="session-1",
            task_name="flood_reasoning",
            image_source="image-url",
            mask_source="mask-url",
            image_b64="image-b64",
            mask_b64="mask-b64",
            mask_stats={"flooded_road_pct_of_image": 10.5},
            conversation=memory,
            context="CTX",
        )
        client = self.model_handler.OllamaClient(
            "http://localhost:11434",
            "gemma4:e2b-it-q4_K_M",
            10,
        )

        with patch.object(
            client,
            "chat",
            side_effect=self.model_handler.OllamaClientError(
                "OLLAMA_TIMEOUT",
                "timed out",
            ),
        ):
            with self.assertRaises(self.model_handler.OllamaClientError) as ctx:
                self.model_handler.return_response(
                    client=client,
                    generation_config=self.model_handler.build_generation_config(),
                    initial_state=state,
                    memory=memory,
                    question="",
                )

        self.assertEqual(ctx.exception.code, "OLLAMA_TIMEOUT")
        self.assertEqual(len(memory.turns), 0)

    def test_client_retries_loading_model_response(self):
        client = self.model_handler.OllamaClient(
            "http://localhost:11434",
            "gemma4:e2b-it-q4_K_M",
            10,
        )

        class FakeResponse:
            def __init__(self, status_code, text, payload):
                self.status_code = status_code
                self.text = text
                self._payload = payload

            def json(self):
                return self._payload

        responses = [
            FakeResponse(
                500,
                '{"error":"unexpected server status: llm server loading model"}',
                {},
            ),
            FakeResponse(200, "ok", {"message": {"content": "OK"}}),
        ]

        with patch.object(client.session, "post", side_effect=responses), patch.object(
            self.model_handler.time,
            "sleep",
        ) as mock_sleep:
            result = client.chat([{"role": "user", "content": "hi"}], {"num_predict": 2})

        self.assertEqual(result, "OK")
        mock_sleep.assert_called_once()


if __name__ == "__main__":
    unittest.main()
