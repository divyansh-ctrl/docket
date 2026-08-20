import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { INHERIT, anthropic, describeChoice, frontmatterModel, needsCredential, readChoice, sameChoice } =
  jiti("../src/shared/agent-model.ts");

test("the same model on two services is two configurations", () => {
  // The reason this type exists. Different endpoint, credential, cost and rate
  // limit -- collapsing them to one label hides the difference exactly where
  // someone would look for it.
  const hosted = readChoice({ provider: "openrouter", model: "z-ai/glm-5.2:free", credential: "openrouter" });
  const local = readChoice({ provider: "ollama", model: "z-ai/glm-5.2:free", credential: null });
  assert.equal(sameChoice(hosted, local), false);
  assert.equal(describeChoice(hosted), "z-ai/glm-5.2:free via openrouter");
  assert.equal(describeChoice(local), "z-ai/glm-5.2:free via ollama");
});

test("the single string this used to be still reads", () => {
  // Every value the old shape could hold was an Anthropic alias, so the
  // provider is not a guess -- it is the only thing it could have meant.
  for (const alias of ["opus", "sonnet", "haiku", "fable"]) {
    assert.deepEqual(readChoice(alias), { provider: "anthropic", model: alias, credential: null });
  }
  assert.deepEqual(readChoice("inherit"), INHERIT);
});

test("a value that names nothing is refused rather than half-read", () => {
  for (const value of [
    null,
    42,
    [],
    "gpt-5",
    { provider: "anthropic" },
    { provider: "anthropic", model: "   " },
    { provider: "carrier-pigeon", model: "x" },
    { model: "x" },
  ]) {
    assert.equal(readChoice(value), null, JSON.stringify(value));
  }
});

test("inheriting writes no model key at all", () => {
  // The file should say nothing where Docket has nothing to say; the literal
  // word "inherit" in frontmatter would be a setting rather than an absence.
  assert.equal(frontmatterModel(INHERIT), null);
  assert.equal(frontmatterModel(anthropic("opus")), "opus");
});

test("a non-Anthropic model emits its id, not an Anthropic word", () => {
  // Reaching it means pointing Claude Code at a gateway, and the far end wants
  // the id the gateway maps.
  const choice = readChoice({ provider: "openrouter", model: "z-ai/glm-5.2:free", credential: "openrouter" });
  assert.equal(frontmatterModel(choice), "z-ai/glm-5.2:free");
});

test("only the providers that actually need a key are said to need one", () => {
  assert.equal(needsCredential(anthropic("opus")), false, "the CLI's own sign-in");
  assert.equal(needsCredential(INHERIT), false);
  assert.equal(needsCredential(readChoice({ provider: "ollama", model: "llama", credential: null })), false, "local");
  assert.equal(needsCredential(readChoice({ provider: "lmstudio", model: "llama", credential: null })), false, "local");
  assert.equal(needsCredential(readChoice({ provider: "openrouter", model: "x", credential: null })), true);
  assert.equal(needsCredential(readChoice({ provider: "openai", model: "x", credential: null })), true);
});

test("a credential is named, never held", () => {
  // This record is written into Docket's configuration file, which is not
  // built to hold a secret at rest.
  const choice = readChoice({ provider: "openrouter", model: "x", credential: "sk-live-abcdef123456" });
  // The name is stored verbatim; what must never happen is a *value* field.
  assert.deepEqual(Object.keys(choice).sort(), ["credential", "model", "provider"]);
  assert.equal(readChoice({ provider: "openrouter", model: "x", credential: "" }).credential, null);
});

test("a choice is frozen so a caller cannot edit the stored one", () => {
  const choice = anthropic("opus");
  assert.throws(() => {
    "use strict";
    choice.model = "haiku";
  });
});
