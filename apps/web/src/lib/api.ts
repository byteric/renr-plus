import { apiErrorSchema, healthResponseSchema } from '@renr/contracts';

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');
export class RequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly fields: { field: string; message: string }[] = [],
    public readonly code = '',
  ) {
    const messages: Record<number, string> = {
      0: 'Sem conexão com o serviço. Confira sua rede e tente novamente.',
      400: 'Confira os campos informados e tente novamente.',
      401: 'Sua sessão terminou. Entre novamente para continuar.',
      403: 'Você não tem permissão para realizar esta ação.',
      404: 'Este registro não está mais disponível. Atualize a lista.',
      409: 'Já existe um registro com esses dados. Confira o cadastro.',
      413: 'O arquivo excede o limite de 5 MiB.',
      415: 'Formato não permitido. Envie PDF, PNG ou JPEG.',
      429: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
      503: 'Serviço temporariamente indisponível. Tente novamente em instantes.',
    };
    const codes: Record<string, string> = {
      INVITE_UNAVAILABLE:
        'Este convite está indisponível, expirou ou já foi utilizado. Solicite outro convite ao responsável.',
      CYCLE_NOT_OPEN: 'O ciclo não está aberto para participação.',
      INVALID_CYCLE_TRANSITION: 'Esta mudança não está disponível para o estado atual do ciclo.',
      INVALID_ANSWERS: 'Confira as respostas obrigatórias e as opções selecionadas.',
    };
    super(
      codes[code] ?? messages[status] ?? 'Não foi possível concluir a operação. Tente novamente.',
    );
  }
}
export async function request<T>(
  path: string,
  schema: { parse: (value: unknown) => T },
  options: RequestInit = {},
): Promise<T> {
  const response = await send(path, options);
  try {
    const data: unknown = await response.json();
    return schema.parse(data);
  } catch {
    throw new RequestError(502);
  }
}
export async function send(path: string, options: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      credentials: options.credentials ?? 'include',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      headers: {
        Accept: 'application/json',
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new RequestError(0);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const parsed = apiErrorSchema.safeParse(body);
    throw new RequestError(
      response.status,
      parsed.success ? parsed.data.details : [],
      parsed.success ? parsed.data.code : '',
    );
  }
  return response;
}
export const getHealth = (signal: AbortSignal) =>
  request('/health', healthResponseSchema, { signal });
