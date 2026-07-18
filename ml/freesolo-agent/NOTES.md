# NOTES — questions for the Freesolo teammate (master: please relay)

From **llm-client**. The integration client (`client/farmhand.py`) is running in
mock mode; answers to these let us flip to the real model by setting one env var.

1. **Endpoint**: what URL do we hit for inference (and is there an API key)?
   We currently assume `POST $FARMHAND_URL` with body `{"text": "<command>"}`.
2. **Request format**: if it's not `{"text": ...}` — e.g. OpenAI-style
   `{"messages": [...]}` or Freesolo's own shape — send an example curl.
3. **Response format**: does the model return the bare action JSON
   (`{"task":"pick","fruit":"apple","filter":"ripe"}`), or is it wrapped
   (e.g. `{"output": "..."}` with the JSON inside a string)? We handle both,
   but confirming avoids surprises.
4. **Clarifications**: for ambiguous commands ("pick the fruit"), does the model
   emit a question? In what shape? We accept `{"clarify": "..."}` /
   `{"clarification": "..."}` / `{"question": "..."}`.
5. **Schema agreement**: we validate strictly against
   `task ∈ pick|sort|stop|drive`, `fruit ∈ apple|banana|any`,
   `filter ∈ ripe|unripe|any`, `zone ∈ any|left|right|forward|backward|home`
   (matches the `data/` SFT dataset; missing keys default to `any`, output
   always carries all 4 keys). Anything else is
   REJECTED and never reaches the robot — if the model was trained with extra
   fields or different enums, tell us now.
6. **Dataset**: do you want the synthetic SFT dataset llm-data is building in
   `data/` (1.5k+ pairs, JSONL)? What format does Freesolo's trainer expect?

Answers → drop them in this file or tell master; we'll adapt `endpoint_model()`
/ `parse_model_body()` in `client/farmhand.py` (single point of change).
