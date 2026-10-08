// Shared Ajv setup: loads every schema in /schemas once and validates data against it by name.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaDir = path.join(root, 'schemas');
const schemaBase = 'https://ai-signal.example/schemas/';

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
for (const f of (await readdir(schemaDir)).filter((n) => n.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(await readFile(path.join(schemaDir, f), 'utf8')));
}

/** Returns a list of readable error strings; empty means valid. `kind` is a schema name like 'raw-item'. */
export function schemaErrors(kind, data) {
  const validate = ajv.getSchema(`${schemaBase}${kind}.schema.json`);
  if (!validate) throw new Error(`unknown schema: ${kind}`);
  if (validate(data)) return [];
  return validate.errors.map((e) => {
    const extra = e.params.additionalProperty ?? e.params.unevaluatedProperty;
    return `${e.instancePath || '/'}: ${e.message}${extra ? ` "${extra}"` : ''}`;
  });
}
