# NOTES - questions for the Freesolo teammate (master: please relay)

From **the NL client**. The integration client (`client/farmhand.py`) is running in
mock mode; answers to these let us flip to the real model by setting one env var.

1. **Endpoint**: what URL do we hit for inference (and is there an API key)?
   We currently assume `POST $FARMHAND_URL` with body `{"text": "<command>"}`.
2. **Request format**: if it's not `{"text": ...}` - e.g. OpenAI-style
   `{"messages": [...]}` or Freesolo's own shape - send an example curl.
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
   REJECTED and never reaches the robot - if the model was trained with extra
   fields or different enums, tell us now.
6. **Dataset**: do you want the synthetic SFT dataset being built in
   `data/` (1.5k+ pairs, JSONL)? What format does Freesolo's trainer expect?

Answers -> drop them in this file or tell master; we'll adapt `endpoint_model()`
/ `parse_model_body()` in `client/farmhand.py` (single point of change).

---

## RESOLVED (the NL client trained the model directly on Freesolo)

Freesolo = freesolo.co "Flash". Answers to the questions above, from their docs +
an actual trained+deployed run:
1/2/3. Endpoint is **OpenAI-compatible**: `POST <base>/v1/chat/completions`,
   `Authorization: Bearer <FREESOLO_API_KEY>`, body `{"model":"<run-id>","messages":[...]}`.
   Response is standard OpenAI (`choices[0].message.content`). client/farmhand.py
   speaks this now.
4. Clarifications: the model returns `{"clarify":"..."}` JSON (our validator accepts it).
5. Schema: confirmed - we trained ON our schema (system prompt + dataset), so the
   model emits exactly `task/fruit/filter/zone` or `{"clarify":...}`.
6. Dataset format: Freesolo uses `{"input","output"}` rows via an environment.py;
   converter in training/convert_dataset.py. Trainer = `flash train configs/*.toml`.

Current best model: **SFT+GRPO, 96.7%** (run flash-1784358461-eb122d48), deployed
and wired into client/.env. Full training setup in training/ (see IMPROVEMENT_PLAN.md).
