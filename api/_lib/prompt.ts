/**
 * api/_lib/prompt.ts — the shared verdict contract for every provider
 *
 * One prompt and one schema serve both classification backends
 * (`_lib/openai.ts` and `_lib/gemini.ts`), so a verdict means the same thing
 * whichever model produced it. `openai.ts` re-exports these symbols for its
 * existing imports; Gemini projects the schema into its own `Schema` dialect
 * in `_lib/gemini.ts`.
 */

/**
 * Canonical labels, kept short and in the same shape as the app's seeded
 * diagnoses so `aiLabel` reads consistently on-chain. They are examples for
 * the prompt, not an enum — `label` is free-form within the 32-byte on-chain
 * limit, and `parseClassification` enforces that limit at the edge.
 */
export const CROP_DISEASE_LABELS = [
  'No disease detected',
  'Gray Leaf Spot',
  'Sclerotinia Head Rot',
  'Sudden Death Syndrome',
  'Downy Mildew',
  'Powdery Mildew',
  'Late Blight',
  'Leaf Rust',
  'Northern Corn Leaf Blight',
  'Frogeye Leaf Spot',
  'Aphid Infestation',
  'Nutrient Deficiency',
  'Drought Stress',
  'Weed Pressure',
  'Unknown',
] as const

export const VISION_PROMPT = [
  'You are an agronomy vision classifier for field crops.',
  'Given one or more field photographs of the same plant, identify the most likely disease, pest or stress issue',
  'and return the structured verdict described by the response schema.',
  'Rules:',
  '- When several photos are provided they are shots of one plant — weigh every angle together and',
  'answer for that plant as a whole, not per photo.',
  `- "label" is short and free-form but at most 32 ASCII characters, for example: ${CROP_DISEASE_LABELS.slice(1, 6).join(', ')}.`,
  '- When no crop is visible use "No Crop Detected"; when the photo is too blurry, dark or close',
  'to judge use "Unclear Image"; when the plant looks unaffected use "Healthy".',
  '- "confidence" is an honest, calibrated probability between 0 and 1. Reserve above 0.85 for',
  'textbook symptoms, 0.5 to 0.7 for plausible but ambiguous evidence, and below 0.4 when the',
  'image or the symptom is largely uncertain. Never inflate it to sound sure.',
  '- "severity" is how urgent the finding is: "high" for severe or fast-spreading damage,',
  '"medium" for established damage, "low" for mild, early or uncertain symptoms, and "none"',
  'when there is nothing to act on (healthy, no crop, or an unclear photo).',
  '- "notes" is one or two plain sentences, at most 200 characters, that a field scout can act on:',
  'what is visible and where. Do not name pesticide, fungicide or fertilizer products, brands or',
  'dosages — describe the symptom and its extent only.',
  '- "commonName" is the plant the photo shows, in plain English (e.g. "Maize", "Tomato"), and',
  '"botanicalName" its Latin binomial (e.g. "Zea mays", "Solanum lycopersicum"). Return "" for',
  'both when the plant cannot be identified or no plant is visible.',
  '- "pathogenName" is the scientific name of the causal agent behind the diagnosis — fungus,',
  'bacterium, virus or pest — e.g. "Ustilago maydis" for Corn Smut or "Cercospora zeae-maydis" for',
  'Gray Leaf Spot. Return "" when the finding is abiotic (drought, nutrient deficiency, physical',
  'damage) or the agent itself cannot be identified.',
  '- Return only the structured verdict; no prose, no markdown.',
].join('\n')

/**
 * Strict-mode schema for the verdict (OpenAI's lowercase JSON-schema dialect).
 * Length and range caps are deliberately left to `parseClassification` (the
 * app-side contract owns `aiLabel`'s 32 bytes); the schema pins the shape and
 * the severity vocabulary, which is exactly what strict mode is good at.
 */
export const EVENT_DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    label: {
      type: 'string',
      description: 'Short ASCII diagnosis of at most 32 characters, e.g. "Gray Leaf Spot".',
    },
    confidence: {
      type: 'number',
      description: 'Honest calibrated probability between 0 and 1.',
    },
    severity: {
      type: 'string',
      enum: ['high', 'medium', 'low', 'none'],
      description: 'Urgency: high, medium, low, or none.',
    },
    notes: {
      type: 'string',
      description: 'One or two plain sentences, at most 200 characters, no product names or doses.',
    },
    commonName: {
      type: 'string',
      description: 'Plain-English common name of the plant shown, e.g. "Maize"; empty when not identifiable.',
    },
    botanicalName: {
      type: 'string',
      description: 'Latin binomial of the plant shown, e.g. "Zea mays"; empty when not identifiable.',
    },
    pathogenName: {
      type: 'string',
      description: 'Scientific name of the causal agent, e.g. "Ustilago maydis"; empty when abiotic or unknown.',
    },
  },
  required: ['label', 'confidence', 'severity', 'notes', 'commonName', 'botanicalName', 'pathogenName'],
  additionalProperties: false,
} as const
