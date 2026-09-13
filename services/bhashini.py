"""Bhashini (ULCA) client: speech-to-text, translation and text-to-speech.

Flow per the Bhashini API docs (bhashini.gitbook.io/bhashini-apis):
  1. Pipeline Config call  -> returns serviceIds + a compute endpoint + key
  2. Pipeline Compute call -> does the actual ASR / translation / TTS
Config answers are cached for an hour so most requests are a single call.

Keys stay on the server; the browser only ever talks to /api/bhashini/*.
"""
import json
import time
import urllib.error
import urllib.request

CONFIG_URL = "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"
DEFAULT_PIPELINE_ID = "64392f96daac500b55c543cd"  # MeitY pipeline; override in config.env
CACHE_SECONDS = 3600


class BhashiniError(Exception):
    pass


class Bhashini:
    def __init__(self, user_id, api_key, pipeline_id=None, timeout=30):
        self.user_id = (user_id or "").strip()
        self.api_key = (api_key or "").strip()
        self.pipeline_id = (pipeline_id or DEFAULT_PIPELINE_ID).strip()
        self.timeout = timeout
        self._cache = {}

    @property
    def configured(self):
        return bool(self.user_id and self.api_key)

    def _post(self, url, headers, body):
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            try:
                detail = json.loads(detail).get("message", detail)
            except (ValueError, AttributeError):
                pass
            raise BhashiniError(f"Bhashini returned {e.code}: {detail}") from e
        except urllib.error.URLError as e:
            raise BhashiniError(f"Could not reach Bhashini ({e.reason}). Check the internet connection.") from e
        except TimeoutError as e:
            raise BhashiniError("Bhashini took too long to answer. Try again.") from e

    def _pipeline(self, task_type, language):
        """Returns (compute_url, auth_header, service_id) for one task + language."""
        if not self.configured:
            raise BhashiniError("Bhashini keys are not set. Add them to config.env and restart.")
        key = json.dumps([task_type, language], sort_keys=True)
        hit = self._cache.get(key)
        if hit and hit[0] > time.time():
            return hit[1]
        body = {
            "pipelineTasks": [{"taskType": task_type, "config": {"language": language}}],
            "pipelineRequestConfig": {"pipelineId": self.pipeline_id},
        }
        cfg = self._post(CONFIG_URL, {"userID": self.user_id, "ulcaApiKey": self.api_key}, body)
        try:
            endpoint = cfg["pipelineInferenceAPIEndPoint"]
            auth = endpoint["inferenceApiKey"]
            service_id = cfg["pipelineResponseConfig"][0]["config"][0]["serviceId"]
            result = (endpoint["callbackUrl"], {auth["name"]: auth["value"]}, service_id)
        except (KeyError, IndexError, TypeError) as e:
            raise BhashiniError("Bhashini has no model for this language right now.") from e
        self._cache[key] = (time.time() + CACHE_SECONDS, result)
        return result

    def _compute(self, task_type, language, extra_config, input_data):
        url, auth, service_id = self._pipeline(task_type, language)
        config = {"language": language, "serviceId": service_id, **extra_config}
        body = {"pipelineTasks": [{"taskType": task_type, "config": config}], "inputData": input_data}
        out = self._post(url, auth, body)
        try:
            return out["pipelineResponse"][0]
        except (KeyError, IndexError, TypeError) as e:
            raise BhashiniError("Unexpected response from Bhashini.") from e

    def asr(self, wav_base64, lang):
        """wav_base64: 16 kHz mono WAV. Returns the transcript in `lang`."""
        res = self._compute("asr", {"sourceLanguage": lang},
                            {"audioFormat": "wav", "samplingRate": 16000},
                            {"audio": [{"audioContent": wav_base64}]})
        return (res.get("output") or [{}])[0].get("source", "").strip()

    def translate(self, text, source, target):
        if not text.strip() or source == target:
            return text
        res = self._compute("translation", {"sourceLanguage": source, "targetLanguage": target},
                            {}, {"input": [{"source": text}]})
        return (res.get("output") or [{}])[0].get("target", "").strip()

    def tts(self, text, lang, gender="female"):
        """Returns base64 WAV audio."""
        res = self._compute("tts", {"sourceLanguage": lang},
                            {"gender": gender, "samplingRate": 8000},
                            {"input": [{"source": text}]})
        return (res.get("audio") or [{}])[0].get("audioContent", "")
