import { apiErrorSchema, healthResponseSchema } from '@renr/contracts';

export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');
export const mfaReauthEvent = 'renr:mfa-reauth-required';
export const mfaReauthMessage = 'Entre novamente para verificar o segundo fator da sua conta.';

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
      REPORT_SCOPE_TOO_LARGE: 'Reduza o recorte da emissão e tente novamente.',
      REPORT_GENERATION_BUSY: 'Há outras exportações em andamento. Aguarde e tente novamente.',
      REPORT_GENERATION_DEADLINE: 'O PDF atingiu o tempo limite de geração. Tente novamente.',
      INVALID_ANSWERS: 'Confira as respostas obrigatórias e as opções selecionadas.',
      CONTRACT_ACCESS_SUSPENDED: 'O acesso contratual desta empresa está suspenso no momento.',
      AUTH_MFA_REAUTH_REQUIRED: mfaReauthMessage,
      AUTH_MFA_CODE_INVALID:
        'Código inválido ou já utilizado. Confira o autenticador ou use outro código de recuperação.',
      AUTH_MFA_CHALLENGE_UNAVAILABLE:
        'A verificação expirou ou foi encerrada. Entre novamente para continuar.',
      COLLABORATION_WRITES_DISABLED:
        'A gravação de contribuições técnicas entre SST e Psicologia Organizacional está desabilitada na homologação aguardando validação de negócio.',
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
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(502);
  }
}
export async function send(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      credentials: options.credentials ?? 'include',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
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
    const code = parsed.success ? parsed.data.code : '';
    if (code === 'AUTH_MFA_REAUTH_REQUIRED' && typeof window !== 'undefined')
      window.dispatchEvent(new Event(mfaReauthEvent));
    throw new RequestError(response.status, parsed.success ? parsed.data.details : [], code);
  }
  return response;
}
export const getHealth = (signal: AbortSignal) =>
  request('/health', healthResponseSchema, { signal });
