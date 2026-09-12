import { readFile, mkdir, writeFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

export async function generateValidator() {
  const schema = JSON.parse(await readFile(new URL('../schema/coffee.schema.json', import.meta.url), 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false, code: { source: true, esm: true } });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  // Precompile and bundle the validator: Workers cannot compile schemas with eval.
  const result = await build({
    stdin: { contents: standaloneCode(ajv, validate), resolveDir: process.cwd(), sourcefile: 'validator.js' },
    bundle: true, platform: 'browser', format: 'esm', write: false,
  });
  await mkdir('generated', { recursive: true });
  await writeFile('generated/validate-record.mjs', result.outputFiles[0].text);
  return validate;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  await generateValidator();
}
