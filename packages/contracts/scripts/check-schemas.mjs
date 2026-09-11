import { readFile, readdir } from 'node:fs/promises';

const schemas = new URL('../schemas/', import.meta.url);
const files = (await readdir(schemas)).filter((file) => file.endsWith('.json'));

for (const file of files) {
    const schema = JSON.parse(await readFile(new URL(file, schemas), 'utf8'));
    if (
        schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' ||
        typeof schema.$id !== 'string' ||
        schema.$id.length === 0
    ) {
        throw new Error(
            `${file} must declare a Draft 2020-12 $schema and a non-empty $id.`,
        );
    }
}

console.log(`Validated ${files.length} contract schema files.`);
