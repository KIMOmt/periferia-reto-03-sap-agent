export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  name?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface ToolDefinitionSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface LlmAdapter {
  enviar(
    mensajes: ChatMessage[],
    herramientas: ToolDefinitionSchema[],
    systemPrompt?: string
  ): Promise<LlmResponse>;
}

