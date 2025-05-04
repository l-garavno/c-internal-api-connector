/* eslint-disable unicorn/no-array-push-push */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

run();

function run() {
  dotenv.config({ path: './.env' });
  const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET;
  const AWS_PROFILE = process.env.AWS_PROFILE;

  if (!AWS_S3_BUCKET || !AWS_PROFILE) {
    throw new Error('AWS_S3_BUCKET and AWS_PROFILE must be set');
  }

  execSync(
    `aws s3 sync ${AWS_S3_BUCKET}/configs/service-schema/ ./configs/service-schema/ --profile ${AWS_PROFILE}`,
  );
  const files = fs.readdirSync('./configs/service-schema');

  generateServiceCaller(files);

  execSync(`yarn format`);
}

function generateServiceCaller(files) {
  const tab = '  ';
  let code = `import Ajv, { type AnySchemaObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import axios from 'axios';

export class ApiServices {
  // ===============================
  // Auto-generated services
  // ===============================
  /* TODO: add your own services here!!! */
  // ===============================

  #token: string | undefined;
  // eslint-disable-next-line @typescript-eslint/class-literal-property-style
  readonly #monitorMode = false;
  // eslint-disable-next-line @typescript-eslint/class-literal-property-style
  readonly #baseSchemaUrl = process.env.BASE_SCHEMA_URL;

  #validate: ValidateFunction | undefined;

  constructor() {
    this.#loadValidate().catch(() => {
      throw new Error('Failed to load validate');
    });
  }

  setToken(token: string) {
    this.#token = token;
  }

  clearToken() {
    this.#token = undefined;
  }

  async #loadValidate() {
    if (!this.#baseSchemaUrl) {
      return;
    }
    const schemaUrl = \`\${this.#baseSchemaUrl}/base.json#\`;
    const response = await axios.get<AnySchemaObject>(schemaUrl);

    const ajv = new Ajv({
      loadSchema: async (uri) =>
        axios.get<AnySchemaObject>(uri).then((response) => response.data),
    });
    addFormats(ajv);
    this.#validate = await ajv.compileAsync(response.data);
  }

  async #call<R>({
    service,
    action,
    params,
  }: {
    service: string;
    action: string;
    params: Record<string, unknown>;
  }) {
    const token = this.#token;
    const response = await axios
      .request<R>({
        method: 'POST',
        url: this.#url(service, action),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { authorization: \`Bearer \${token}\` } : {}),
        },
        data: JSON.stringify(params || {}),
      })
      .then((response) => response.data);

    if (this.#monitorMode) {
      const valid = this.#validate
        ? this.#validate({
            service,
            request: {
              action,
              params,
            },
            response,
          })
        : true;
      if (valid) {
        return response;
      }

      throw new Error(JSON.stringify(this.#validate?.errors, null, 2));
    }

    return response;
  }

  #url(service: string, action: string) {
    return \`https://api.example.com/\${service}/\${action}\`;
  }
}
`;
  const lines = [];
  for (const file of files) {
    const service = toCamelCase(file.replace('.json', ''));
    const schema = _load(file);
    const definitions = schema.definitions || {};

    lines.push(`${tab}${service} = {`);
    for (const [method, definition] of Object.entries(definitions)) {
      const parameters = definition.properties.request.properties.params;
      const response = definition.properties.response;
      lines.push(
        `${tab}${tab}${toCamelCase(method)}: (params: ${typeGenerator(parameters)}) => {`,
      );
      lines.push(
        `${tab}${tab}${tab}return this.#call<${typeGenerator(
          response,
        )}>({ service: '${service}', action: '${method}', params })`,
        `${tab}${tab}},`,
      );
    }

    lines.push(`${tab}}`);
  }

  code = code.replace(
    '  /* TODO: add your own services here!!! */',
    lines.join('\n'),
  );
  fs.writeFileSync(`./src/api-service/index.ts`, code);
}

function typeGenerator({ type, items, properties, required }) {
  const isRequired = required
    ? Object.fromEntries(required.map((key) => [key, 1]))
    : {};
  // Ref: https://json-schema.org/understanding-json-schema/reference/type
  switch (type) {
    case 'null': {
      return 'null';
    }

    case 'string': {
      return 'string';
    }

    case 'number':
    case 'integer': {
      return 'number';
    }

    case 'boolean': {
      return 'boolean';
    }

    case 'array': {
      if (items) {
        return `Array<${typeGenerator(items)}>`;
      }

      throw new Error('Array with no items is not supported');
    }

    case 'object': {
      return `{ ${Object.entries(properties)
        .map(([key, value]) => {
          const v = typeGenerator(value);
          const k = isRequired[key] ? key : `${key}?`;
          return `${k}: ${v}`;
        })
        .join(', ')} }`;
    }

    default: {
      throw new Error('Unsupported type');
    }
  }
}

function toCamelCase(string) {
  return string.replaceAll(/(?:^|_)(\w)/g, (_, letter) => letter.toLowerCase());
}

function _load(file) {
  return JSON.parse(
    fs.readFileSync(`./configs/service-schema/${file}`, 'utf8'),
  );
}
