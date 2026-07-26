export interface WebhookPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        messages?: InboundMessage[];
      };
    }>;
  }>;
}

export interface InboundContext {
  id?: string;
  from?: string;
  forwarded?: boolean;
  frequently_forwarded?: boolean;
}

export interface InboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  context?: InboundContext;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; caption?: string; filename?: string; mime_type?: string };
  audio?: { id?: string; voice?: boolean; mime_type?: string };
}
