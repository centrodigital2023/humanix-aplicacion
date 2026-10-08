export interface TicketRow {
  id: string;
  radicado: string | null;
  subject: string;
  description: string;
  type: string | null;
  ai_category: string | null;
  ai_priority: string | null;
  ai_sentiment: string | null;
  ai_summary: string | null;
  status: string;
  created_at: string;
  contact_email: string | null;
  contact_phone: string | null;
  contact_name: string | null;
  user_id: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
  safety_level: string | null;
  safety_categories: string[] | null;
  duplicate_of: string | null;
  ai_reply_draft: string | null;
  reply_draft_edited: boolean | null;
}

export const TICKET_COLUMNS =
  "id,radicado,subject,description,type,ai_category,ai_priority,ai_sentiment,ai_summary,status,created_at,contact_email,contact_phone,contact_name,user_id,assigned_to,assigned_at,due_at,first_response_at,resolved_at,resolution,safety_level,safety_categories,duplicate_of,ai_reply_draft,reply_draft_edited";

export const OFFER_COLUMNS =
  "id,title,description,city,amount,modality,status,created_at,updated_at,poster_type,specialty_required,start_date,end_date,shifts_count,blocked,blocked_reason,posted_by,requirements,address";

export type MarketTab = "overview" | "offers" | "pqrs";
