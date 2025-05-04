import Ajv, { type AnySchemaObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import axios from 'axios';

export class ApiServices {
  // ===============================
  // Auto-generated services
  // ===============================
  sso = {
    registerNewUser: async (parameters: {
      email: string;
      password: string;
    }) => {
      return this.#call<{ success: boolean }>({
        service: 'sso',
        action: 'RegisterNewUser',
        params: parameters,
      });
    },
    loginByEmail: async (parameters: { email: string; password: string }) => {
      return this.#call<{ success: boolean; token?: string }>({
        service: 'sso',
        action: 'LoginByEmail',
        params: parameters,
      });
    },
  };

  user = {
    getProfile: async (parameters: { id: string }) => {
      return this.#call<{ id: string; name: string }>({
        service: 'user',
        action: 'GetProfile',
        params: parameters,
      });
    },
  };
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
    const schemaUrl = `${this.#baseSchemaUrl}/base.json#`;
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
          ...(token ? { authorization: `Bearer ${token}` } : {}),
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
    return `https://api.example.com/${service}/${action}`;
  }
}
