export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_banners: {
        Row: {
          active: boolean
          ai_audience_match: Json | null
          ai_recommendation: string | null
          ai_score: number | null
          audience: string
          clicks: number
          created_at: string
          created_by: string | null
          cta_label: string | null
          description: string | null
          ends_at: string | null
          id: string
          image_url: string | null
          impressions: number
          link_url: string | null
          position: string
          shares_count: number
          starts_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          ai_audience_match?: Json | null
          ai_recommendation?: string | null
          ai_score?: number | null
          audience?: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          impressions?: number
          link_url?: string | null
          position?: string
          shares_count?: number
          starts_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          ai_audience_match?: Json | null
          ai_recommendation?: string | null
          ai_score?: number | null
          audience?: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          impressions?: number
          link_url?: string | null
          position?: string
          shares_count?: number
          starts_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_credits_ledger: {
        Row: {
          created_at: string
          credits_used: number
          feature: string
          id: string
          meta: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_used?: number
          feature: string
          id?: string
          meta?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          credits_used?: number
          feature?: string
          id?: string
          meta?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      application_documents: {
        Row: {
          ai_notes: string | null
          ai_score: number | null
          ai_verified: boolean | null
          application_id: string
          created_at: string
          doc_type: string
          file_name: string | null
          file_url: string
          id: string
          retention_until: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          application_id: string
          created_at?: string
          doc_type: string
          file_name?: string | null
          file_url: string
          id?: string
          retention_until?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          application_id?: string
          created_at?: string
          doc_type?: string
          file_name?: string | null
          file_url?: string
          id?: string
          retention_until?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          created_at: string
          id: string
          job_offer_id: string
          message: string | null
          professional_id: string
          proposed_amount: number | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_offer_id: string
          message?: string | null
          professional_id: string
          proposed_amount?: number | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_offer_id?: string
          message?: string | null
          professional_id?: string
          proposed_amount?: number | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          meta: Json | null
          resource_id: string | null
          resource_type: string | null
          severity: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          meta?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          meta?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      availability_slots: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          job_offer_id: string | null
          note: string | null
          starts_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          job_offer_id?: string | null
          note?: string | null
          starts_at: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          job_offer_id?: string | null
          note?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_slots_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      community_testimonials: {
        Row: {
          author_avatar_url: string | null
          author_city: string | null
          author_name: string
          author_role: Database["public"]["Enums"]["testimonial_role"]
          content: string
          created_at: string
          id: string
          moderated_at: string | null
          moderated_by: string | null
          moderation_note: string | null
          plan_snapshot: string | null
          rating: number
          status: Database["public"]["Enums"]["testimonial_status"]
          trust_score_snapshot: number
          updated_at: string
          user_id: string
        }
        Insert: {
          author_avatar_url?: string | null
          author_city?: string | null
          author_name: string
          author_role: Database["public"]["Enums"]["testimonial_role"]
          content: string
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_note?: string | null
          plan_snapshot?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["testimonial_status"]
          trust_score_snapshot?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          author_avatar_url?: string | null
          author_city?: string | null
          author_name?: string
          author_role?: Database["public"]["Enums"]["testimonial_role"]
          content?: string
          created_at?: string
          id?: string
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_note?: string | null
          plan_snapshot?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["testimonial_status"]
          trust_score_snapshot?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          application_id: string
          created_at: string
          id: string
          last_message_at: string
          poster_id: string
          professional_id: string
        }
        Insert: {
          application_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          poster_id: string
          professional_id: string
        }
        Update: {
          application_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          poster_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_campaigns: {
        Row: {
          ai_subject_suggestions: Json | null
          channel: string
          clicked_count: number | null
          content: string | null
          created_at: string
          created_by: string | null
          delivered_count: number | null
          id: string
          name: string
          opened_count: number | null
          recipients_count: number | null
          scheduled_at: string | null
          segment_filter: Json | null
          sent_at: string | null
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          ai_subject_suggestions?: Json | null
          channel?: string
          clicked_count?: number | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          delivered_count?: number | null
          id?: string
          name: string
          opened_count?: number | null
          recipients_count?: number | null
          scheduled_at?: string | null
          segment_filter?: Json | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          ai_subject_suggestions?: Json | null
          channel?: string
          clicked_count?: number | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          delivered_count?: number | null
          id?: string
          name?: string
          opened_count?: number | null
          recipients_count?: number | null
          scheduled_at?: string | null
          segment_filter?: Json | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_contacts: {
        Row: {
          ai_sentiment: string | null
          ai_summary: string | null
          city: string | null
          created_at: string
          created_by: string | null
          email: string | null
          full_name: string
          id: string
          last_contacted_at: string | null
          lead_score: number | null
          linked_user_id: string | null
          notes: string | null
          phone: string | null
          segment: string | null
          source: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          ai_sentiment?: string | null
          ai_summary?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name: string
          id?: string
          last_contacted_at?: string | null
          lead_score?: number | null
          linked_user_id?: string | null
          notes?: string | null
          phone?: string | null
          segment?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          ai_sentiment?: string | null
          ai_summary?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          full_name?: string
          id?: string
          last_contacted_at?: string | null
          lead_score?: number | null
          linked_user_id?: string | null
          notes?: string | null
          phone?: string | null
          segment?: string | null
          source?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: []
      }
      crm_interactions: {
        Row: {
          body: string | null
          campaign_id: string | null
          completed_at: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          direction: string | null
          due_at: string | null
          id: string
          meta: Json | null
          status: string | null
          subject: string | null
          type: string
        }
        Insert: {
          body?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          direction?: string | null
          due_at?: string | null
          id?: string
          meta?: Json | null
          status?: string | null
          subject?: string | null
          type: string
        }
        Update: {
          body?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          direction?: string | null
          due_at?: string | null
          id?: string
          meta?: Json | null
          status?: string | null
          subject?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_interactions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "crm_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_interactions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "crm_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      document_ai_analyses: {
        Row: {
          analyzed_by: string | null
          created_at: string
          document_id: string
          document_owner_id: string
          document_table: string
          findings: Json | null
          id: string
          model: string | null
          model_version: string | null
          raw_response: Json | null
          score: number | null
          summary: string | null
          verdict: string | null
        }
        Insert: {
          analyzed_by?: string | null
          created_at?: string
          document_id: string
          document_owner_id: string
          document_table: string
          findings?: Json | null
          id?: string
          model?: string | null
          model_version?: string | null
          raw_response?: Json | null
          score?: number | null
          summary?: string | null
          verdict?: string | null
        }
        Update: {
          analyzed_by?: string | null
          created_at?: string
          document_id?: string
          document_owner_id?: string
          document_table?: string
          findings?: Json | null
          id?: string
          model?: string | null
          model_version?: string | null
          raw_response?: Json | null
          score?: number | null
          summary?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      dynamic_forms: {
        Row: {
          created_at: string
          created_by: string
          description: string | null
          fields: Json
          id: string
          is_active: boolean
          name: string
          target_id: string | null
          target_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name: string
          target_id?: string | null
          target_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name?: string
          target_id?: string | null
          target_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      emergency_incidents: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          incident_type: string
          lat: number | null
          lng: number | null
          notes: string | null
          resolved: boolean
          resolved_at: string | null
          triggered_by: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          incident_type?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          resolved?: boolean
          resolved_at?: string | null
          triggered_by: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          incident_type?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          resolved?: boolean
          resolved_at?: string | null
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_incidents_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      family_documents: {
        Row: {
          ai_extracted: Json | null
          ai_notes: string | null
          ai_score: number | null
          ai_verified: boolean | null
          created_at: string
          doc_type: Database["public"]["Enums"]["family_doc_type"]
          file_name: string | null
          file_url: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          status: Database["public"]["Enums"]["doc_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_extracted?: Json | null
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          created_at?: string
          doc_type: Database["public"]["Enums"]["family_doc_type"]
          file_name?: string | null
          file_url: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_extracted?: Json | null
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          created_at?: string
          doc_type?: Database["public"]["Enums"]["family_doc_type"]
          file_name?: string | null
          file_url?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      family_needs: {
        Row: {
          care_type: string | null
          created_at: string
          ends_at: string
          family_user_id: string
          hourly_rate: number
          id: string
          notes: string | null
          service_address: string | null
          starts_at: string
          status: Database["public"]["Enums"]["family_need_status"]
          updated_at: string
        }
        Insert: {
          care_type?: string | null
          created_at?: string
          ends_at: string
          family_user_id: string
          hourly_rate?: number
          id?: string
          notes?: string | null
          service_address?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["family_need_status"]
          updated_at?: string
        }
        Update: {
          care_type?: string | null
          created_at?: string
          ends_at?: string
          family_user_id?: string
          hourly_rate?: number
          id?: string
          notes?: string | null
          service_address?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["family_need_status"]
          updated_at?: string
        }
        Relationships: []
      }
      family_profiles: {
        Row: {
          created_at: string
          default_address: string | null
          default_lat: number | null
          default_lng: number | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          habeas_data_accepted: boolean
          habeas_data_accepted_at: string | null
          id: string
          id_doc_url: string | null
          id_number: string | null
          patient_age: number | null
          patient_name: string | null
          patient_relation: string | null
          patient_summary: string | null
          updated_at: string
          user_id: string
          visible_on_map: boolean
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          default_address?: string | null
          default_lat?: number | null
          default_lng?: number | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          habeas_data_accepted?: boolean
          habeas_data_accepted_at?: string | null
          id?: string
          id_doc_url?: string | null
          id_number?: string | null
          patient_age?: number | null
          patient_name?: string | null
          patient_relation?: string | null
          patient_summary?: string | null
          updated_at?: string
          user_id: string
          visible_on_map?: boolean
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          default_address?: string | null
          default_lat?: number | null
          default_lng?: number | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          habeas_data_accepted?: boolean
          habeas_data_accepted_at?: string | null
          id?: string
          id_doc_url?: string | null
          id_number?: string | null
          patient_age?: number | null
          patient_name?: string | null
          patient_relation?: string | null
          patient_summary?: string | null
          updated_at?: string
          user_id?: string
          visible_on_map?: boolean
          whatsapp?: string | null
        }
        Relationships: []
      }
      form_responses: {
        Row: {
          answers: Json
          form_id: string
          id: string
          respondent_id: string
          submitted_at: string
        }
        Insert: {
          answers?: Json
          form_id: string
          id?: string
          respondent_id: string
          submitted_at?: string
        }
        Update: {
          answers?: Json
          form_id?: string
          id?: string
          respondent_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "dynamic_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_flags: {
        Row: {
          created_at: string
          id: string
          meta: Json | null
          reason: string
          resolved: boolean
          severity: Database["public"]["Enums"]["fraud_severity"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meta?: Json | null
          reason: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["fraud_severity"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meta?: Json | null
          reason?: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["fraud_severity"]
          user_id?: string
        }
        Relationships: []
      }
      institution_documents: {
        Row: {
          ai_extracted: Json | null
          ai_notes: string | null
          ai_score: number | null
          ai_verified: boolean | null
          created_at: string
          doc_type: string
          file_name: string | null
          file_url: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_extracted?: Json | null
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          created_at?: string
          doc_type: string
          file_name?: string | null
          file_url: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_extracted?: Json | null
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          created_at?: string
          doc_type?: string
          file_name?: string | null
          file_url?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      institution_profiles: {
        Row: {
          address: string | null
          chamber_of_commerce_date: string | null
          chamber_of_commerce_number: string | null
          city: string | null
          compliance_fuid: boolean
          compliance_notes: string | null
          created_at: string
          id: string
          institution_name: string
          institution_type: string | null
          lat: number | null
          legal_representative_email: string | null
          legal_representative_name: string | null
          legal_representative_phone: string | null
          lng: number | null
          nit: string | null
          updated_at: string
          user_id: string
          verified: boolean | null
          visible_on_map: boolean
          website: string | null
        }
        Insert: {
          address?: string | null
          chamber_of_commerce_date?: string | null
          chamber_of_commerce_number?: string | null
          city?: string | null
          compliance_fuid?: boolean
          compliance_notes?: string | null
          created_at?: string
          id?: string
          institution_name: string
          institution_type?: string | null
          lat?: number | null
          legal_representative_email?: string | null
          legal_representative_name?: string | null
          legal_representative_phone?: string | null
          lng?: number | null
          nit?: string | null
          updated_at?: string
          user_id: string
          verified?: boolean | null
          visible_on_map?: boolean
          website?: string | null
        }
        Update: {
          address?: string | null
          chamber_of_commerce_date?: string | null
          chamber_of_commerce_number?: string | null
          city?: string | null
          compliance_fuid?: boolean
          compliance_notes?: string | null
          created_at?: string
          id?: string
          institution_name?: string
          institution_type?: string | null
          lat?: number | null
          legal_representative_email?: string | null
          legal_representative_name?: string | null
          legal_representative_phone?: string | null
          lng?: number | null
          nit?: string | null
          updated_at?: string
          user_id?: string
          verified?: boolean | null
          visible_on_map?: boolean
          website?: string | null
        }
        Relationships: []
      }
      interview_schedules: {
        Row: {
          channel: string
          created_at: string
          duration_minutes: number
          id: string
          location: string | null
          message: string | null
          outcome: string | null
          outcome_notes: string | null
          professional_id: string
          scheduled_at: string
          scheduled_by: string
          sent_via: string[] | null
          status: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          location?: string | null
          message?: string | null
          outcome?: string | null
          outcome_notes?: string | null
          professional_id: string
          scheduled_at: string
          scheduled_by: string
          sent_via?: string[] | null
          status?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          location?: string | null
          message?: string | null
          outcome?: string | null
          outcome_notes?: string | null
          professional_id?: string
          scheduled_at?: string
          scheduled_by?: string
          sent_via?: string[] | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_offer_requirements: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_mandatory: boolean
          job_offer_id: string
          priority: number
          requirement_type: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_mandatory?: boolean
          job_offer_id: string
          priority?: number
          requirement_type: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_mandatory?: boolean
          job_offer_id?: string
          priority?: number
          requirement_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_offer_requirements_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      job_offers: {
        Row: {
          address: string | null
          amount: number
          blocked: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          city: string
          contact_phone: string | null
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          lat: number | null
          lng: number | null
          modality: Database["public"]["Enums"]["offer_modality"]
          posted_by: string
          poster_type: Database["public"]["Enums"]["poster_type"]
          requirements: string[] | null
          reserved_until: string | null
          shifts_count: number | null
          specialty_required: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["offer_status"]
          title: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          amount: number
          blocked?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          city: string
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          modality: Database["public"]["Enums"]["offer_modality"]
          posted_by: string
          poster_type: Database["public"]["Enums"]["poster_type"]
          requirements?: string[] | null
          reserved_until?: string | null
          shifts_count?: number | null
          specialty_required?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          title: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          amount?: number
          blocked?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          city?: string
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          modality?: Database["public"]["Enums"]["offer_modality"]
          posted_by?: string
          poster_type?: Database["public"]["Enums"]["poster_type"]
          requirements?: string[] | null
          reserved_until?: string | null
          shifts_count?: number | null
          specialty_required?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_ai_suggestion: boolean
          sender_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          is_ai_suggestion?: boolean
          sender_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_ai_suggestion?: boolean
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          description: string | null
          id: string
          mp_payment_id: string | null
          mp_preference_id: string | null
          paid_at: string | null
          raw_payload: Json | null
          status: Database["public"]["Enums"]["mp_payment_status"]
          subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          paid_at?: string | null
          raw_payload?: Json | null
          status?: Database["public"]["Enums"]["mp_payment_status"]
          subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          paid_at?: string | null
          raw_payload?: Json | null
          status?: Database["public"]["Enums"]["mp_payment_status"]
          subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mp_payments_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "mp_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_subscriptions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          current_period_end: string | null
          id: string
          mp_payer_email: string | null
          mp_preapproval_id: string | null
          next_payment_at: string | null
          plan: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          mp_payer_email?: string | null
          mp_preapproval_id?: string | null
          next_payment_at?: string | null
          plan?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          current_period_end?: string | null
          id?: string
          mp_payer_email?: string | null
          mp_preapproval_id?: string | null
          next_payment_at?: string | null
          plan?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          id: string
          link: string | null
          meta: Json | null
          read_at: string | null
          sent_via_wa: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          link?: string | null
          meta?: Json | null
          read_at?: string | null
          sent_via_wa?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          id?: string
          link?: string | null
          meta?: Json | null
          read_at?: string | null
          sent_via_wa?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      offer_embeddings: {
        Row: {
          embedding: string | null
          offer_id: string
          source_text: string | null
          updated_at: string
        }
        Insert: {
          embedding?: string | null
          offer_id: string
          source_text?: string | null
          updated_at?: string
        }
        Update: {
          embedding?: string | null
          offer_id?: string
          source_text?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_embeddings_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      pqrs_tickets: {
        Row: {
          ai_category: string | null
          ai_priority: string | null
          ai_sentiment: string | null
          ai_summary: string | null
          assigned_to: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          description: string
          id: string
          resolution: string | null
          resolved_at: string | null
          status: string
          subject: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_category?: string | null
          ai_priority?: string | null
          ai_sentiment?: string | null
          ai_summary?: string | null
          assigned_to?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          subject: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_category?: string | null
          ai_priority?: string | null
          ai_sentiment?: string | null
          ai_summary?: string | null
          assigned_to?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
          subject?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      professional_deletion_log: {
        Row: {
          created_at: string
          deleted_by: string
          deleted_by_email: string | null
          deleted_email: string | null
          deleted_full_name: string | null
          deleted_user_id: string
          id: string
          reason: string | null
          snapshot: Json | null
        }
        Insert: {
          created_at?: string
          deleted_by: string
          deleted_by_email?: string | null
          deleted_email?: string | null
          deleted_full_name?: string | null
          deleted_user_id: string
          id?: string
          reason?: string | null
          snapshot?: Json | null
        }
        Update: {
          created_at?: string
          deleted_by?: string
          deleted_by_email?: string | null
          deleted_email?: string | null
          deleted_full_name?: string | null
          deleted_user_id?: string
          id?: string
          reason?: string | null
          snapshot?: Json | null
        }
        Relationships: []
      }
      professional_documents: {
        Row: {
          ai_extracted: Json | null
          ai_notes: string | null
          ai_score: number | null
          ai_verified: boolean | null
          created_at: string
          doc_type: Database["public"]["Enums"]["doc_type"]
          file_name: string | null
          file_url: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_note: string | null
          status: Database["public"]["Enums"]["doc_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_extracted?: Json | null
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          created_at?: string
          doc_type: Database["public"]["Enums"]["doc_type"]
          file_name?: string | null
          file_url: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_extracted?: Json | null
          ai_notes?: string | null
          ai_score?: number | null
          ai_verified?: boolean | null
          created_at?: string
          doc_type?: Database["public"]["Enums"]["doc_type"]
          file_name?: string | null
          file_url?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_note?: string | null
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      professional_profiles: {
        Row: {
          active: boolean | null
          ai_preapproved: boolean | null
          ai_strengths: string[] | null
          ai_suggestions: string[] | null
          ai_summary: string | null
          availability: Json | null
          available: boolean
          avatar_url: string | null
          avg_rating: number | null
          bio: string | null
          blocked: boolean
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          certifications: Json | null
          created_at: string
          gender: string | null
          home_city: string | null
          hourly_rate: number | null
          id: string
          languages: string[] | null
          last_validation_id: string | null
          lat: number | null
          lng: number | null
          monthly_rate: number | null
          published: boolean
          published_at: string | null
          reserved_until: string | null
          rethus_number: string | null
          rethus_verified: boolean | null
          service_cities: string[] | null
          shift_rate: number | null
          social_trust_breakdown: Json | null
          social_trust_score: number | null
          social_trust_updated_at: string | null
          specialty: string | null
          sub_specialties: string[] | null
          total_jobs: number | null
          trust_score: number | null
          updated_at: string
          user_id: string
          verified: boolean | null
          work_experience: Json | null
          years_experience: number | null
        }
        Insert: {
          active?: boolean | null
          ai_preapproved?: boolean | null
          ai_strengths?: string[] | null
          ai_suggestions?: string[] | null
          ai_summary?: string | null
          availability?: Json | null
          available?: boolean
          avatar_url?: string | null
          avg_rating?: number | null
          bio?: string | null
          blocked?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          certifications?: Json | null
          created_at?: string
          gender?: string | null
          home_city?: string | null
          hourly_rate?: number | null
          id?: string
          languages?: string[] | null
          last_validation_id?: string | null
          lat?: number | null
          lng?: number | null
          monthly_rate?: number | null
          published?: boolean
          published_at?: string | null
          reserved_until?: string | null
          rethus_number?: string | null
          rethus_verified?: boolean | null
          service_cities?: string[] | null
          shift_rate?: number | null
          social_trust_breakdown?: Json | null
          social_trust_score?: number | null
          social_trust_updated_at?: string | null
          specialty?: string | null
          sub_specialties?: string[] | null
          total_jobs?: number | null
          trust_score?: number | null
          updated_at?: string
          user_id: string
          verified?: boolean | null
          work_experience?: Json | null
          years_experience?: number | null
        }
        Update: {
          active?: boolean | null
          ai_preapproved?: boolean | null
          ai_strengths?: string[] | null
          ai_suggestions?: string[] | null
          ai_summary?: string | null
          availability?: Json | null
          available?: boolean
          avatar_url?: string | null
          avg_rating?: number | null
          bio?: string | null
          blocked?: boolean
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          certifications?: Json | null
          created_at?: string
          gender?: string | null
          home_city?: string | null
          hourly_rate?: number | null
          id?: string
          languages?: string[] | null
          last_validation_id?: string | null
          lat?: number | null
          lng?: number | null
          monthly_rate?: number | null
          published?: boolean
          published_at?: string | null
          reserved_until?: string | null
          rethus_number?: string | null
          rethus_verified?: boolean | null
          service_cities?: string[] | null
          shift_rate?: number | null
          social_trust_breakdown?: Json | null
          social_trust_score?: number | null
          social_trust_updated_at?: string | null
          specialty?: string | null
          sub_specialties?: string[] | null
          total_jobs?: number | null
          trust_score?: number | null
          updated_at?: string
          user_id?: string
          verified?: boolean | null
          work_experience?: Json | null
          years_experience?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_profiles_last_validation_id_fkey"
            columns: ["last_validation_id"]
            isOneToOne: false
            referencedRelation: "profile_validations"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_references: {
        Row: {
          created_at: string
          full_name: string
          id: string
          notes: string | null
          phone: string
          ref_type: string
          relation: string | null
          updated_at: string
          user_id: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          notes?: string | null
          phone: string
          ref_type: string
          relation?: string | null
          updated_at?: string
          user_id: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string
          ref_type?: string
          relation?: string | null
          updated_at?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      profile_embeddings: {
        Row: {
          embedding: string | null
          source_text: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          embedding?: string | null
          source_text?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          embedding?: string | null
          source_text?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_validations: {
        Row: {
          ai_summary: string | null
          created_at: string
          critical_errors: Json
          id: string
          is_publishable: boolean
          score: number | null
          user_id: string
          validated_at: string
          warnings: Json
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          critical_errors?: Json
          id?: string
          is_publishable?: boolean
          score?: number | null
          user_id: string
          validated_at?: string
          warnings?: Json
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          critical_errors?: Json
          id?: string
          is_publishable?: boolean
          score?: number | null
          user_id?: string
          validated_at?: string
          warnings?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          job_offer_id: string | null
          rated_user_id: string
          rater_user_id: string
          stars: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          job_offer_id?: string | null
          rated_user_id: string
          rater_user_id: string
          stars: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          job_offer_id?: string | null
          rated_user_id?: string
          rater_user_id?: string
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      service_bookings: {
        Row: {
          application_id: string | null
          arrived_at: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          client_id: string
          completed_at: string | null
          created_at: string
          duration_hours: number
          emergency_phone: string | null
          hourly_rate: number
          id: string
          job_offer_id: string | null
          notes: string | null
          payment_mode: string
          platform_fee_amount: number
          platform_fee_pct: number
          professional_id: string
          professional_payout: number
          scheduled_at: string
          service_address: string | null
          service_lat: number | null
          service_lng: number | null
          started_at: string | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          arrived_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_id: string
          completed_at?: string | null
          created_at?: string
          duration_hours?: number
          emergency_phone?: string | null
          hourly_rate: number
          id?: string
          job_offer_id?: string | null
          notes?: string | null
          payment_mode?: string
          platform_fee_amount?: number
          platform_fee_pct?: number
          professional_id: string
          professional_payout?: number
          scheduled_at: string
          service_address?: string | null
          service_lat?: number | null
          service_lng?: number | null
          started_at?: string | null
          status?: string
          total_amount: number
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          arrived_at?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          client_id?: string
          completed_at?: string | null
          created_at?: string
          duration_hours?: number
          emergency_phone?: string | null
          hourly_rate?: number
          id?: string
          job_offer_id?: string | null
          notes?: string | null
          payment_mode?: string
          platform_fee_amount?: number
          platform_fee_pct?: number
          professional_id?: string
          professional_payout?: number
          scheduled_at?: string
          service_address?: string | null
          service_lat?: number | null
          service_lng?: number | null
          started_at?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_ratings: {
        Row: {
          ai_alert: boolean
          ai_sentiment: string | null
          ai_sentiment_score: number | null
          ai_summary: string | null
          booking_id: string
          comment: string | null
          created_at: string
          id: string
          rated_id: string
          rater_id: string
          stars: number
          voice_transcript: string | null
          voice_url: string | null
        }
        Insert: {
          ai_alert?: boolean
          ai_sentiment?: string | null
          ai_sentiment_score?: number | null
          ai_summary?: string | null
          booking_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rated_id: string
          rater_id: string
          stars: number
          voice_transcript?: string | null
          voice_url?: string | null
        }
        Update: {
          ai_alert?: boolean
          ai_sentiment?: string | null
          ai_sentiment_score?: number | null
          ai_summary?: string | null
          booking_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rated_id?: string
          rater_id?: string
          stars?: number
          voice_transcript?: string | null
          voice_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_ratings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      slot_proposals: {
        Row: {
          availability_slot_id: string | null
          booking_id: string | null
          created_at: string
          decision_note: string | null
          ends_at: string
          family_need_id: string | null
          family_user_id: string
          hourly_rate: number
          id: string
          message: string | null
          professional_id: string
          proposed_by: Database["public"]["Enums"]["slot_proposal_proposed_by"]
          starts_at: string
          status: Database["public"]["Enums"]["slot_proposal_status"]
          updated_at: string
        }
        Insert: {
          availability_slot_id?: string | null
          booking_id?: string | null
          created_at?: string
          decision_note?: string | null
          ends_at: string
          family_need_id?: string | null
          family_user_id: string
          hourly_rate?: number
          id?: string
          message?: string | null
          professional_id: string
          proposed_by: Database["public"]["Enums"]["slot_proposal_proposed_by"]
          starts_at: string
          status?: Database["public"]["Enums"]["slot_proposal_status"]
          updated_at?: string
        }
        Update: {
          availability_slot_id?: string | null
          booking_id?: string | null
          created_at?: string
          decision_note?: string | null
          ends_at?: string
          family_need_id?: string | null
          family_user_id?: string
          hourly_rate?: number
          id?: string
          message?: string | null
          professional_id?: string
          proposed_by?: Database["public"]["Enums"]["slot_proposal_proposed_by"]
          starts_at?: string
          status?: Database["public"]["Enums"]["slot_proposal_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slot_proposals_availability_slot_id_fkey"
            columns: ["availability_slot_id"]
            isOneToOne: false
            referencedRelation: "availability_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "slot_proposals_family_need_id_fkey"
            columns: ["family_need_id"]
            isOneToOne: false
            referencedRelation: "family_needs"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invitations: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          expires_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tracking_pings: {
        Row: {
          accuracy_m: number | null
          booking_id: string
          created_at: string
          heading: number | null
          id: string
          lat: number
          lng: number
          professional_id: string
          speed_mps: number | null
        }
        Insert: {
          accuracy_m?: number | null
          booking_id: string
          created_at?: string
          heading?: number | null
          id?: string
          lat: number
          lng: number
          professional_id: string
          speed_mps?: number | null
        }
        Update: {
          accuracy_m?: number | null
          booking_id?: string
          created_at?: string
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          professional_id?: string
          speed_mps?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tracking_pings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          consent_type: string
          granted: boolean
          granted_at: string
          id: string
          ip_address: string | null
          revoked_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          consent_type: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: string | null
          revoked_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          consent_type?: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: string | null
          revoked_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vital_signs_readings: {
        Row: {
          created_at: string
          family_user_id: string
          id: string
          notes: string | null
          patient_label: string | null
          reading_type: string
          recorded_at: string
          recorded_by: string | null
          severity: string
          source: string
          unit: string | null
          value: number
          value_secondary: number | null
        }
        Insert: {
          created_at?: string
          family_user_id: string
          id?: string
          notes?: string | null
          patient_label?: string | null
          reading_type: string
          recorded_at?: string
          recorded_by?: string | null
          severity?: string
          source?: string
          unit?: string | null
          value: number
          value_secondary?: number | null
        }
        Update: {
          created_at?: string
          family_user_id?: string
          id?: string
          notes?: string | null
          patient_label?: string | null
          reading_type?: string
          recorded_at?: string
          recorded_by?: string | null
          severity?: string
          source?: string
          unit?: string | null
          value?: number
          value_secondary?: number | null
        }
        Relationships: []
      }
      wearable_connections: {
        Row: {
          connected_at: string
          device_name: string | null
          external_user_id: string
          id: string
          last_error: string | null
          last_synced_at: string | null
          patient_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          connected_at?: string
          device_name?: string | null
          external_user_id?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          patient_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          connected_at?: string
          device_name?: string | null
          external_user_id?: string
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          patient_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_contacts: {
        Row: {
          ai_enabled: boolean
          created_at: string
          display_name: string | null
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          linked_user_id: string | null
          owner_id: string
          phone: string
          tag: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          linked_user_id?: string | null
          owner_id: string
          phone: string
          tag?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          linked_user_id?: string | null
          owner_id?: string
          phone?: string
          tag?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          body: string
          contact_id: string
          created_at: string
          direction: string
          id: string
          is_ai: boolean
          wa_message_id: string | null
        }
        Insert: {
          body: string
          contact_id: string
          created_at?: string
          direction: string
          id?: string
          is_ai?: boolean
          wa_message_id?: string | null
        }
        Update: {
          body?: string
          contact_id?: string
          created_at?: string
          direction?: string
          id?: string
          is_ai?: boolean
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      professional_profiles_public: {
        Row: {
          active: boolean | null
          ai_strengths: string[] | null
          ai_summary: string | null
          availability: Json | null
          available: boolean | null
          avatar_url: string | null
          avg_rating: number | null
          bio: string | null
          certifications: Json | null
          created_at: string | null
          home_city: string | null
          hourly_rate: number | null
          id: string | null
          languages: string[] | null
          monthly_rate: number | null
          published: boolean | null
          published_at: string | null
          rethus_verified: boolean | null
          service_cities: string[] | null
          shift_rate: number | null
          specialty: string | null
          sub_specialties: string[] | null
          total_jobs: number | null
          trust_score: number | null
          updated_at: string | null
          user_id: string | null
          verified: boolean | null
          work_experience: Json | null
          years_experience: number | null
        }
        Insert: {
          active?: boolean | null
          ai_strengths?: string[] | null
          ai_summary?: string | null
          availability?: Json | null
          available?: boolean | null
          avatar_url?: string | null
          avg_rating?: number | null
          bio?: string | null
          certifications?: Json | null
          created_at?: string | null
          home_city?: string | null
          hourly_rate?: number | null
          id?: string | null
          languages?: string[] | null
          monthly_rate?: number | null
          published?: boolean | null
          published_at?: string | null
          rethus_verified?: boolean | null
          service_cities?: string[] | null
          shift_rate?: number | null
          specialty?: string | null
          sub_specialties?: string[] | null
          total_jobs?: number | null
          trust_score?: number | null
          updated_at?: string | null
          user_id?: string | null
          verified?: boolean | null
          work_experience?: Json | null
          years_experience?: number | null
        }
        Update: {
          active?: boolean | null
          ai_strengths?: string[] | null
          ai_summary?: string | null
          availability?: Json | null
          available?: boolean | null
          avatar_url?: string | null
          avg_rating?: number | null
          bio?: string | null
          certifications?: Json | null
          created_at?: string | null
          home_city?: string | null
          hourly_rate?: number | null
          id?: string | null
          languages?: string[] | null
          monthly_rate?: number | null
          published?: boolean | null
          published_at?: string | null
          rethus_verified?: boolean | null
          service_cities?: string[] | null
          shift_rate?: number | null
          specialty?: string | null
          sub_specialties?: string[] | null
          total_jobs?: number | null
          trust_score?: number | null
          updated_at?: string | null
          user_id?: string | null
          verified?: boolean | null
          work_experience?: Json | null
          years_experience?: number | null
        }
        Relationships: []
      }
      public_family_map_safe: {
        Row: {
          avatar_url: string | null
          default_address: string | null
          default_lat: number | null
          default_lng: number | null
          full_name: string | null
          has_exact_location: boolean | null
          patient_name: string | null
          phone: string | null
          user_id: string | null
          visible_on_map: boolean | null
          whatsapp: string | null
        }
        Relationships: []
      }
      public_institutions_safe: {
        Row: {
          address: string | null
          avatar_url: string | null
          city: string | null
          full_name: string | null
          has_exact_location: boolean | null
          institution_name: string | null
          institution_type: string | null
          lat: number | null
          lng: number | null
          phone: string | null
          user_id: string | null
          visible_on_map: boolean | null
        }
        Relationships: []
      }
      public_professionals_safe: {
        Row: {
          active: boolean | null
          ai_preapproved: boolean | null
          ai_strengths: string[] | null
          ai_summary: string | null
          availability: Json | null
          availability_status: string | null
          available: boolean | null
          avatar_url: string | null
          avg_rating: number | null
          bio: string | null
          certifications: Json | null
          full_name: string | null
          gender: string | null
          has_exact_location: boolean | null
          home_city: string | null
          hourly_rate: number | null
          languages: string[] | null
          lat: number | null
          lng: number | null
          monthly_rate: number | null
          phone: string | null
          published: boolean | null
          reserved_until: string | null
          rethus_verified: boolean | null
          service_cities: string[] | null
          shift_rate: number | null
          specialty: string | null
          sub_specialties: string[] | null
          total_jobs: number | null
          trust_score: number | null
          user_id: string | null
          verified: boolean | null
          work_experience: Json | null
          years_experience: number | null
        }
        Relationships: []
      }
      public_profiles_safe: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          full_name: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ad_track: { Args: { _id: string; _kind: string }; Returns: undefined }
      get_my_profile: {
        Args: never
        Returns: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_platform_counts: {
        Args: never
        Returns: {
          completed_services: number
          families_online: number
          families_total: number
          institutions_online: number
          institutions_total: number
          professionals_available: number
          professionals_online: number
          professionals_rethus: number
          professionals_total: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      log_audit: {
        Args: {
          _action: string
          _meta?: Json
          _resource_id?: string
          _resource_type?: string
          _severity?: string
        }
        Returns: string
      }
      match_offers_for_professional: {
        Args: {
          _match_count?: number
          _min_similarity?: number
          _user_id: string
        }
        Returns: {
          offer_id: string
          similarity: number
        }[]
      }
      match_professionals_for_offer: {
        Args: {
          _match_count?: number
          _min_similarity?: number
          _offer_id: string
        }
        Returns: {
          similarity: number
          user_id: string
        }[]
      }
      publish_profile: { Args: { _validation_id?: string }; Returns: Json }
      redeem_staff_invitation: {
        Args: { _token: string }
        Returns: {
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      release_expired_reservations: { Args: never; Returns: undefined }
      set_offer_reserved: {
        Args: { _offer_id: string; _professional_id: string }
        Returns: undefined
      }
      staff_get_profile: {
        Args: { _user_id: string }
        Returns: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      wearable_ingest_by_pairing_code: {
        Args: {
          blood_pressure_dia?: number
          blood_pressure_sys?: number
          device_name?: string
          heart_rate?: number
          measured_at?: string
          p_provider?: string
          pairing_code: string
          source?: string
          spo2?: number
          steps?: number
          temperature?: number
        }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "professional"
        | "family"
        | "institution"
        | "superadmin"
        | "hr_staff"
        | "evaluator"
      application_status: "pending" | "accepted" | "rejected" | "withdrawn"
      doc_status: "pending" | "approved" | "rejected"
      doc_type:
        | "cv"
        | "rethus"
        | "diploma"
        | "id_document"
        | "other"
        | "utility_bill"
        | "work_reference"
        | "family_reference"
        | "work_experience"
        | "public_function_cv"
        | "medical_exam"
        | "contraloria"
        | "procuraduria"
        | "criminal_record"
        | "corrective_measures"
        | "health_affiliation"
        | "pension_affiliation"
        | "arl_affiliation"
        | "redam"
        | "disqualifications"
        | "assets_declaration"
        | "bank_account"
      family_doc_type:
        | "id_document"
        | "utility_bill"
        | "patient_id"
        | "medical_history"
        | "authorization"
        | "insurance"
        | "other"
      family_need_status: "open" | "matched" | "cancelled" | "expired"
      fraud_severity: "low" | "medium" | "high" | "critical"
      mp_payment_status:
        | "pending"
        | "approved"
        | "rejected"
        | "cancelled"
        | "refunded"
        | "in_process"
      offer_modality: "hour" | "shift" | "month" | "package"
      offer_status: "open" | "closed" | "filled"
      poster_type: "family" | "institution"
      slot_proposal_proposed_by: "family" | "professional"
      slot_proposal_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "cancelled"
        | "expired"
      subscription_plan: "free" | "pro" | "family" | "institution"
      subscription_status: "active" | "cancelled" | "past_due" | "trialing"
      testimonial_role: "professional" | "family" | "institution"
      testimonial_status: "pending" | "published" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "professional",
        "family",
        "institution",
        "superadmin",
        "hr_staff",
        "evaluator",
      ],
      application_status: ["pending", "accepted", "rejected", "withdrawn"],
      doc_status: ["pending", "approved", "rejected"],
      doc_type: [
        "cv",
        "rethus",
        "diploma",
        "id_document",
        "other",
        "utility_bill",
        "work_reference",
        "family_reference",
        "work_experience",
        "public_function_cv",
        "medical_exam",
        "contraloria",
        "procuraduria",
        "criminal_record",
        "corrective_measures",
        "health_affiliation",
        "pension_affiliation",
        "arl_affiliation",
        "redam",
        "disqualifications",
        "assets_declaration",
        "bank_account",
      ],
      family_doc_type: [
        "id_document",
        "utility_bill",
        "patient_id",
        "medical_history",
        "authorization",
        "insurance",
        "other",
      ],
      family_need_status: ["open", "matched", "cancelled", "expired"],
      fraud_severity: ["low", "medium", "high", "critical"],
      mp_payment_status: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "refunded",
        "in_process",
      ],
      offer_modality: ["hour", "shift", "month", "package"],
      offer_status: ["open", "closed", "filled"],
      poster_type: ["family", "institution"],
      slot_proposal_proposed_by: ["family", "professional"],
      slot_proposal_status: [
        "pending",
        "accepted",
        "rejected",
        "cancelled",
        "expired",
      ],
      subscription_plan: ["free", "pro", "family", "institution"],
      subscription_status: ["active", "cancelled", "past_due", "trialing"],
      testimonial_role: ["professional", "family", "institution"],
      testimonial_status: ["pending", "published", "rejected"],
    },
  },
} as const
