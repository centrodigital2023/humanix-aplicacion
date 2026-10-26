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
      admin_code_attempts: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ai_credit_packs_catalog: {
        Row: {
          active: boolean
          bonus_pct: number
          created_at: string
          credits: number
          description: string | null
          id: string
          name: string
          price_cop: number
          sort_order: number
          validity_days: number
        }
        Insert: {
          active?: boolean
          bonus_pct?: number
          created_at?: string
          credits: number
          description?: string | null
          id: string
          name: string
          price_cop: number
          sort_order?: number
          validity_days?: number
        }
        Update: {
          active?: boolean
          bonus_pct?: number
          created_at?: string
          credits?: number
          description?: string | null
          id?: string
          name?: string
          price_cop?: number
          sort_order?: number
          validity_days?: number
        }
        Relationships: []
      }
      ai_credit_topups: {
        Row: {
          created_at: string
          credits: number
          credits_used: number
          expires_at: string
          id: string
          mp_payment_id: string | null
          mp_preference_id: string | null
          pack_id: string | null
          price_cop: number
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits: number
          credits_used?: number
          expires_at: string
          id?: string
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          pack_id?: string | null
          price_cop: number
          source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits?: number
          credits_used?: number
          expires_at?: string
          id?: string
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          pack_id?: string | null
          price_cop?: number
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_credit_topups_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "ai_credit_packs_catalog"
            referencedColumns: ["id"]
          },
        ]
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
      applicant_contact_reveals: {
        Row: {
          application_id: string | null
          created_at: string
          family_user_id: string
          id: string
          plan: string
          professional_id: string
          proposal_id: string | null
          revealed_on: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          family_user_id: string
          id?: string
          plan: string
          professional_id: string
          proposal_id?: string | null
          revealed_on: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          family_user_id?: string
          id?: string
          plan?: string
          professional_id?: string
          proposal_id?: string | null
          revealed_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "applicant_contact_reveals_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applicant_contact_reveals_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "slot_proposals"
            referencedColumns: ["id"]
          },
        ]
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
      application_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          amount: number | null
          application_id: string
          created_at: string
          event: string
          id: number
          message: string | null
          round_no: number
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          amount?: number | null
          application_id: string
          created_at?: string
          event: string
          id?: number
          message?: string | null
          round_no?: number
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          amount?: number | null
          application_id?: string
          created_at?: string
          event?: string
          id?: number
          message?: string | null
          round_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          accepted_at: string | null
          agreed_amount: number | null
          awaiting: string
          closed_reason: string | null
          created_at: string
          decision_note: string | null
          expires_at: string | null
          id: string
          job_offer_id: string
          message: string | null
          posted_amount: number | null
          professional_id: string
          proposed_amount: number | null
          round_no: number
          shift_ids: string[]
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          agreed_amount?: number | null
          awaiting?: string
          closed_reason?: string | null
          created_at?: string
          decision_note?: string | null
          expires_at?: string | null
          id?: string
          job_offer_id: string
          message?: string | null
          posted_amount?: number | null
          professional_id: string
          proposed_amount?: number | null
          round_no?: number
          shift_ids?: string[]
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          agreed_amount?: number | null
          awaiting?: string
          closed_reason?: string | null
          created_at?: string
          decision_note?: string | null
          expires_at?: string | null
          id?: string
          job_offer_id?: string
          message?: string | null
          posted_amount?: number | null
          professional_id?: string
          proposed_amount?: number | null
          round_no?: number
          shift_ids?: string[]
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
      booking_contact_reveals: {
        Row: {
          booking_id: string
          channel: string
          created_at: string
          id: string
          revealer_id: string
        }
        Insert: {
          booking_id: string
          channel?: string
          created_at?: string
          id?: string
          revealer_id: string
        }
        Update: {
          booking_id?: string
          channel?: string
          created_at?: string
          id?: string
          revealer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_contact_reveals_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      care_circle_members: {
        Row: {
          accepted_at: string | null
          can_view_services: boolean
          created_at: string
          id: string
          invited_email: string
          member_id: string | null
          owner_id: string
          relation: string | null
          status: string
        }
        Insert: {
          accepted_at?: string | null
          can_view_services?: boolean
          created_at?: string
          id?: string
          invited_email: string
          member_id?: string | null
          owner_id: string
          relation?: string | null
          status?: string
        }
        Update: {
          accepted_at?: string | null
          can_view_services?: boolean
          created_at?: string
          id?: string
          invited_email?: string
          member_id?: string | null
          owner_id?: string
          relation?: string | null
          status?: string
        }
        Relationships: []
      }
      care_favorites: {
        Row: {
          client_id: string
          created_at: string
          note: string | null
          professional_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          note?: string | null
          professional_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          note?: string | null
          professional_id?: string
        }
        Relationships: []
      }
      care_kudos: {
        Row: {
          booking_id: string
          created_at: string
          from_role: string
          from_user: string
          id: string
          kinds: string[]
          message: string | null
          to_user: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          from_role: string
          from_user: string
          id?: string
          kinds: string[]
          message?: string | null
          to_user: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          from_role?: string
          from_user?: string
          id?: string
          kinds?: string[]
          message?: string | null
          to_user?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_kudos_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      care_logs: {
        Row: {
          alert_reason: string | null
          booking_id: string
          created_at: string
          description: string
          event_type: string
          id: string
          is_alert: boolean
          mood: string | null
          notified_at: string | null
          patient_name: string | null
          photo_url: string | null
          professional_id: string
          system_generated: boolean
          vital_diastolic: number | null
          vital_heart_rate: number | null
          vital_oxygen: number | null
          vital_systolic: number | null
          vital_temperature: number | null
        }
        Insert: {
          alert_reason?: string | null
          booking_id: string
          created_at?: string
          description: string
          event_type: string
          id?: string
          is_alert?: boolean
          mood?: string | null
          notified_at?: string | null
          patient_name?: string | null
          photo_url?: string | null
          professional_id: string
          system_generated?: boolean
          vital_diastolic?: number | null
          vital_heart_rate?: number | null
          vital_oxygen?: number | null
          vital_systolic?: number | null
          vital_temperature?: number | null
        }
        Update: {
          alert_reason?: string | null
          booking_id?: string
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          is_alert?: boolean
          mood?: string | null
          notified_at?: string | null
          patient_name?: string | null
          photo_url?: string | null
          professional_id?: string
          system_generated?: boolean
          vital_diastolic?: number | null
          vital_heart_rate?: number | null
          vital_oxygen?: number | null
          vital_systolic?: number | null
          vital_temperature?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "care_logs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_alerts: {
        Row: {
          accuracy_m: number | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_value: number
          alert_type: string
          booking_id: string | null
          created_at: string
          id: string
          inapp_notified: number
          lat: number | null
          lng: number | null
          notes: string | null
          notified_at: string | null
          notified_email: boolean
          notified_push: boolean
          notified_whatsapp: boolean
          patient_id: string
          resolved_at: string | null
          severity: string
          status: string
          tenant_id: string | null
          threshold_value: number | null
          triggered_by: string | null
          unit: string | null
          vital_sign_id: string | null
        }
        Insert: {
          accuracy_m?: number | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_value?: number
          alert_type: string
          booking_id?: string | null
          created_at?: string
          id?: string
          inapp_notified?: number
          lat?: number | null
          lng?: number | null
          notes?: string | null
          notified_at?: string | null
          notified_email?: boolean
          notified_push?: boolean
          notified_whatsapp?: boolean
          patient_id: string
          resolved_at?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          threshold_value?: number | null
          triggered_by?: string | null
          unit?: string | null
          vital_sign_id?: string | null
        }
        Update: {
          accuracy_m?: number | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_value?: number
          alert_type?: string
          booking_id?: string | null
          created_at?: string
          id?: string
          inapp_notified?: number
          lat?: number | null
          lng?: number | null
          notes?: string | null
          notified_at?: string | null
          notified_email?: boolean
          notified_push?: boolean
          notified_whatsapp?: boolean
          patient_id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          tenant_id?: string | null
          threshold_value?: number | null
          triggered_by?: string | null
          unit?: string | null
          vital_sign_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_alerts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
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
          application_id: string | null
          booking_id: string | null
          created_at: string
          id: string
          last_message_at: string
          poster_id: string
          professional_id: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          booking_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          poster_id: string
          professional_id: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          booking_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string
          poster_id?: string
          professional_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
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
      function_execution_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_code: string | null
          execution_id: string | null
          function_name: string
          id: string
          metadata: Json
          status: string
          trigger_type: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          execution_id?: string | null
          function_name: string
          id?: string
          metadata?: Json
          status: string
          trigger_type: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          execution_id?: string | null
          function_name?: string
          id?: string
          metadata?: Json
          status?: string
          trigger_type?: string
        }
        Relationships: []
      }
      inst_alerts: {
        Row: {
          ack_note: string | null
          acked_at: string | null
          acked_by: string | null
          acked_by_name: string | null
          created_at: string
          due_ack_at: string
          escalated_at: string | null
          escalation_level: number
          id: string
          institution_id: string
          last_seen_at: string
          message: string
          news2: number | null
          obs_id: string | null
          occurrences: number
          opened_at: string
          patient_id: string
          reason: string
          resolution: string | null
          resolve_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          severity: string
          status: string
        }
        Insert: {
          ack_note?: string | null
          acked_at?: string | null
          acked_by?: string | null
          acked_by_name?: string | null
          created_at?: string
          due_ack_at: string
          escalated_at?: string | null
          escalation_level?: number
          id?: string
          institution_id: string
          last_seen_at?: string
          message: string
          news2?: number | null
          obs_id?: string | null
          occurrences?: number
          opened_at?: string
          patient_id: string
          reason: string
          resolution?: string | null
          resolve_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          severity: string
          status?: string
        }
        Update: {
          ack_note?: string | null
          acked_at?: string | null
          acked_by?: string | null
          acked_by_name?: string | null
          created_at?: string
          due_ack_at?: string
          escalated_at?: string | null
          escalation_level?: number
          id?: string
          institution_id?: string
          last_seen_at?: string
          message?: string
          news2?: number | null
          obs_id?: string | null
          occurrences?: number
          opened_at?: string
          patient_id?: string
          reason?: string
          resolution?: string | null
          resolve_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inst_alerts_obs_id_fkey"
            columns: ["obs_id"]
            isOneToOne: false
            referencedRelation: "inst_obs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inst_alerts_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inst_cases: {
        Row: {
          application_id: string | null
          care_type: string
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          institution_id: string
          opened_at: string
          outcome: string | null
          patient_id: string
          priority: string
          professional_id: string | null
          professional_label: string | null
          satisfaction: number | null
          satisfaction_by: string | null
          satisfaction_note: string | null
          status: string
          summary: string | null
          target_end_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          care_type?: string
          closed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          institution_id: string
          opened_at?: string
          outcome?: string | null
          patient_id: string
          priority?: string
          professional_id?: string | null
          professional_label?: string | null
          satisfaction?: number | null
          satisfaction_by?: string | null
          satisfaction_note?: string | null
          status?: string
          summary?: string | null
          target_end_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          care_type?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          institution_id?: string
          opened_at?: string
          outcome?: string | null
          patient_id?: string
          priority?: string
          professional_id?: string | null
          professional_label?: string | null
          satisfaction?: number | null
          satisfaction_by?: string | null
          satisfaction_note?: string | null
          status?: string
          summary?: string | null
          target_end_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inst_cases_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inst_cases_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inst_devices: {
        Row: {
          code_hash: string
          code_hint: string
          created_at: string
          created_by: string
          id: string
          institution_id: string
          kind: string
          label: string
          last_ingest_at: string | null
          patient_id: string
          revoked_at: string | null
          status: string
        }
        Insert: {
          code_hash: string
          code_hint: string
          created_at?: string
          created_by: string
          id?: string
          institution_id: string
          kind?: string
          label: string
          last_ingest_at?: string | null
          patient_id: string
          revoked_at?: string | null
          status?: string
        }
        Update: {
          code_hash?: string
          code_hint?: string
          created_at?: string
          created_by?: string
          id?: string
          institution_id?: string
          kind?: string
          label?: string
          last_ingest_at?: string | null
          patient_id?: string
          revoked_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "inst_devices_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inst_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          case_id: string | null
          created_at: string
          data: Json
          id: string
          institution_id: string
          kind: string
          patient_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          case_id?: string | null
          created_at?: string
          data?: Json
          id?: string
          institution_id: string
          kind: string
          patient_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          case_id?: string | null
          created_at?: string
          data?: Json
          id?: string
          institution_id?: string
          kind?: string
          patient_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inst_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "inst_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inst_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inst_ingest_failures: {
        Row: {
          at: string
          id: number
          ip_hash: string
          scope: string
        }
        Insert: {
          at?: string
          id?: number
          ip_hash: string
          scope: string
        }
        Update: {
          at?: string
          id?: number
          ip_hash?: string
          scope?: string
        }
        Relationships: []
      }
      inst_live: {
        Row: {
          institution_id: string
          last_band: string | null
          last_device_at: string | null
          last_news2: number | null
          last_obs_at: string | null
          last_obs_source: string | null
          last_vitals: Json | null
          next_obs_due_at: string | null
          patient_id: string
          updated_at: string
        }
        Insert: {
          institution_id: string
          last_band?: string | null
          last_device_at?: string | null
          last_news2?: number | null
          last_obs_at?: string | null
          last_obs_source?: string | null
          last_vitals?: Json | null
          next_obs_due_at?: string | null
          patient_id: string
          updated_at?: string
        }
        Update: {
          institution_id?: string
          last_band?: string | null
          last_device_at?: string | null
          last_news2?: number | null
          last_obs_at?: string | null
          last_obs_source?: string | null
          last_vitals?: Json | null
          next_obs_due_at?: string | null
          patient_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inst_live_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: true
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inst_notes: {
        Row: {
          author_id: string
          author_name: string
          author_role: string
          body: string
          case_id: string | null
          corrects_note_id: string | null
          created_at: string
          hash: string
          id: string
          institution_id: string
          kind: string
          patient_id: string
          prev_hash: string
          seq: number
          vitals: Json | null
        }
        Insert: {
          author_id: string
          author_name: string
          author_role: string
          body: string
          case_id?: string | null
          corrects_note_id?: string | null
          created_at?: string
          hash: string
          id?: string
          institution_id: string
          kind: string
          patient_id: string
          prev_hash: string
          seq: number
          vitals?: Json | null
        }
        Update: {
          author_id?: string
          author_name?: string
          author_role?: string
          body?: string
          case_id?: string | null
          corrects_note_id?: string | null
          created_at?: string
          hash?: string
          id?: string
          institution_id?: string
          kind?: string
          patient_id?: string
          prev_hash?: string
          seq?: number
          vitals?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "inst_notes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "inst_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inst_notes_corrects_note_id_fkey"
            columns: ["corrects_note_id"]
            isOneToOne: false
            referencedRelation: "inst_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inst_notes_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inst_obs: {
        Row: {
          applicable: boolean
          avpu: string | null
          band: string | null
          created_at: string
          dbp: number | null
          device_id: string | null
          fall: boolean
          hr: number | null
          id: string
          institution_id: string
          news2: number | null
          news2_input: Json | null
          news2_max_single: number | null
          news2_measured: number | null
          note: string | null
          on_o2: boolean | null
          pain: number | null
          patient_id: string
          recorded_at: string
          recorded_by: string | null
          recorded_by_name: string | null
          rr: number | null
          sbp: number | null
          source: string
          spo2: number | null
          temp_c: number | null
        }
        Insert: {
          applicable?: boolean
          avpu?: string | null
          band?: string | null
          created_at?: string
          dbp?: number | null
          device_id?: string | null
          fall?: boolean
          hr?: number | null
          id?: string
          institution_id: string
          news2?: number | null
          news2_input?: Json | null
          news2_max_single?: number | null
          news2_measured?: number | null
          note?: string | null
          on_o2?: boolean | null
          pain?: number | null
          patient_id: string
          recorded_at?: string
          recorded_by?: string | null
          recorded_by_name?: string | null
          rr?: number | null
          sbp?: number | null
          source?: string
          spo2?: number | null
          temp_c?: number | null
        }
        Update: {
          applicable?: boolean
          avpu?: string | null
          band?: string | null
          created_at?: string
          dbp?: number | null
          device_id?: string | null
          fall?: boolean
          hr?: number | null
          id?: string
          institution_id?: string
          news2?: number | null
          news2_input?: Json | null
          news2_max_single?: number | null
          news2_measured?: number | null
          note?: string | null
          on_o2?: boolean | null
          pain?: number | null
          patient_id?: string
          recorded_at?: string
          recorded_by?: string | null
          recorded_by_name?: string | null
          rr?: number | null
          sbp?: number | null
          source?: string
          spo2?: number | null
          temp_c?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inst_obs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "inst_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inst_obs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
      }
      inst_patients: {
        Row: {
          address: string | null
          allergies: string[]
          birth_date: string | null
          city: string | null
          conditions: string[]
          consent_confirmed_at: string
          consent_confirmed_by: string
          created_at: string
          created_by: string
          discharged_at: string | null
          document_number: string | null
          document_type: string | null
          emergency_name: string | null
          emergency_phone: string | null
          eps_name: string | null
          external_ref: string | null
          family_updates_ok: boolean
          full_name: string
          id: string
          institution_id: string
          modality: string
          monitoring: boolean
          monitoring_since: string | null
          room: string | null
          sex: string | null
          spo2_scale: number
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          allergies?: string[]
          birth_date?: string | null
          city?: string | null
          conditions?: string[]
          consent_confirmed_at?: string
          consent_confirmed_by: string
          created_at?: string
          created_by: string
          discharged_at?: string | null
          document_number?: string | null
          document_type?: string | null
          emergency_name?: string | null
          emergency_phone?: string | null
          eps_name?: string | null
          external_ref?: string | null
          family_updates_ok?: boolean
          full_name: string
          id?: string
          institution_id: string
          modality?: string
          monitoring?: boolean
          monitoring_since?: string | null
          room?: string | null
          sex?: string | null
          spo2_scale?: number
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          allergies?: string[]
          birth_date?: string | null
          city?: string | null
          conditions?: string[]
          consent_confirmed_at?: string
          consent_confirmed_by?: string
          created_at?: string
          created_by?: string
          discharged_at?: string | null
          document_number?: string | null
          document_type?: string | null
          emergency_name?: string | null
          emergency_phone?: string | null
          eps_name?: string | null
          external_ref?: string | null
          family_updates_ok?: boolean
          full_name?: string
          id?: string
          institution_id?: string
          modality?: string
          monitoring?: boolean
          monitoring_since?: string | null
          room?: string | null
          sex?: string | null
          spo2_scale?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      inst_tasks: {
        Row: {
          case_id: string | null
          completed_at: string | null
          completed_by: string | null
          completed_name: string | null
          created_at: string
          created_by: string
          due_at: string
          id: string
          institution_id: string
          kind: string
          patient_id: string
          source: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          case_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_name?: string | null
          created_at?: string
          created_by: string
          due_at: string
          id?: string
          institution_id: string
          kind?: string
          patient_id: string
          source?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          case_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_name?: string | null
          created_at?: string
          created_by?: string
          due_at?: string
          id?: string
          institution_id?: string
          kind?: string
          patient_id?: string
          source?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inst_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "inst_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inst_tasks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "inst_patients"
            referencedColumns: ["id"]
          },
        ]
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
      institution_member_actions: {
        Row: {
          action: string
          created_at: string
          id: number
          institution_id: string
          member_name: string | null
          member_user_id: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: never
          institution_id: string
          member_name?: string | null
          member_user_id: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: never
          institution_id?: string
          member_name?: string | null
          member_user_id?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: []
      }
      institution_members: {
        Row: {
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          institution_id: string
          job_title: string | null
          last_seen_at: string | null
          member_user_id: string
          modules: string[]
          status: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          display_name: string
          id?: string
          institution_id: string
          job_title?: string | null
          last_seen_at?: string | null
          member_user_id: string
          modules?: string[]
          status?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          institution_id?: string
          job_title?: string | null
          last_seen_at?: string | null
          member_user_id?: string
          modules?: string[]
          status?: string
          updated_at?: string
          username?: string
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
      job_offer_private: {
        Row: {
          access_notes: string | null
          address: string | null
          contact_phone: string | null
          exact_lat: number | null
          exact_lng: number | null
          job_offer_id: string
          updated_at: string
        }
        Insert: {
          access_notes?: string | null
          address?: string | null
          contact_phone?: string | null
          exact_lat?: number | null
          exact_lng?: number | null
          job_offer_id: string
          updated_at?: string
        }
        Update: {
          access_notes?: string | null
          address?: string | null
          contact_phone?: string | null
          exact_lat?: number | null
          exact_lng?: number | null
          job_offer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_offer_private_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: true
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
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
      job_offer_shifts: {
        Row: {
          created_at: string
          ends_at: string
          filled: number
          id: string
          job_offer_id: string
          positions: number
          starts_at: string
          status: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          filled?: number
          id?: string
          job_offer_id: string
          positions?: number
          starts_at: string
          status?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          filled?: number
          id?: string
          job_offer_id?: string
          positions?: number
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_offer_shifts_job_offer_id_fkey"
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
          is_urgent: boolean
          lat: number | null
          lng: number | null
          modality: Database["public"]["Enums"]["offer_modality"]
          posted_by: string
          poster_type: Database["public"]["Enums"]["poster_type"]
          requirements: string[] | null
          reserved_until: string | null
          service_area: string | null
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
          is_urgent?: boolean
          lat?: number | null
          lng?: number | null
          modality: Database["public"]["Enums"]["offer_modality"]
          posted_by: string
          poster_type: Database["public"]["Enums"]["poster_type"]
          requirements?: string[] | null
          reserved_until?: string | null
          service_area?: string | null
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
          is_urgent?: boolean
          lat?: number | null
          lng?: number | null
          modality?: Database["public"]["Enums"]["offer_modality"]
          posted_by?: string
          poster_type?: Database["public"]["Enums"]["poster_type"]
          requirements?: string[] | null
          reserved_until?: string | null
          service_area?: string | null
          shifts_count?: number | null
          specialty_required?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["offer_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_captures: {
        Row: {
          care_scope: string | null
          contact_channel: string | null
          created_at: string
          email: string | null
          frequency: string | null
          id: string
          whatsapp: string | null
        }
        Insert: {
          care_scope?: string | null
          contact_channel?: string | null
          created_at?: string
          email?: string | null
          frequency?: string | null
          id?: string
          whatsapp?: string | null
        }
        Update: {
          care_scope?: string | null
          contact_channel?: string | null
          created_at?: string
          email?: string | null
          frequency?: string | null
          id?: string
          whatsapp?: string | null
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
      offer_notify_log: {
        Row: {
          id: string
          kind: string
          notified_at: string
          poster_id: string
          professional_id: string
        }
        Insert: {
          id?: string
          kind: string
          notified_at?: string
          poster_id: string
          professional_id: string
        }
        Update: {
          id?: string
          kind?: string
          notified_at?: string
          poster_id?: string
          professional_id?: string
        }
        Relationships: []
      }
      offer_team_invites: {
        Row: {
          created_at: string
          invited_by: string
          job_offer_id: string
          professional_id: string
        }
        Insert: {
          created_at?: string
          invited_by: string
          job_offer_id: string
          professional_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string
          job_offer_id?: string
          professional_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offer_team_invites_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_alert_log: {
        Row: {
          alert_id: string
          family_user_id: string
          notified_at: string
        }
        Insert: {
          alert_id: string
          family_user_id: string
          notified_at?: string
        }
        Update: {
          alert_id?: string
          family_user_id?: string
          notified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_alert_log_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "opportunity_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_alerts: {
        Row: {
          active: boolean
          care_types: string[]
          cities: string[]
          created_at: string
          id: string
          min_rate: number | null
          name: string
          professional_id: string
          urgent_only: boolean
        }
        Insert: {
          active?: boolean
          care_types?: string[]
          cities?: string[]
          created_at?: string
          id?: string
          min_rate?: number | null
          name?: string
          professional_id: string
          urgent_only?: boolean
        }
        Update: {
          active?: boolean
          care_types?: string[]
          cities?: string[]
          created_at?: string
          id?: string
          min_rate?: number | null
          name?: string
          professional_id?: string
          urgent_only?: boolean
        }
        Relationships: []
      }
      opportunity_contact_reveals: {
        Row: {
          counterpart_kind: string
          created_at: string
          family_need_id: string | null
          family_user_id: string
          id: string
          job_offer_id: string | null
          plan: string
          professional_id: string
          revealed_on: string
        }
        Insert: {
          counterpart_kind?: string
          created_at?: string
          family_need_id?: string | null
          family_user_id: string
          id?: string
          job_offer_id?: string | null
          plan: string
          professional_id: string
          revealed_on?: string
        }
        Update: {
          counterpart_kind?: string
          created_at?: string
          family_need_id?: string | null
          family_user_id?: string
          id?: string
          job_offer_id?: string | null
          plan?: string
          professional_id?: string
          revealed_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_contact_reveals_family_need_id_fkey"
            columns: ["family_need_id"]
            isOneToOne: false
            referencedRelation: "family_needs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_contact_reveals_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          error_code: string | null
          event_type: string | null
          external_event_id: string
          id: string
          payload_hash: string | null
          processed: boolean
          processed_at: string | null
          provider: string
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          error_code?: string | null
          event_type?: string | null
          external_event_id: string
          id?: string
          payload_hash?: string | null
          processed?: boolean
          processed_at?: string | null
          provider: string
          received_at?: string
          signature_valid?: boolean
        }
        Update: {
          error_code?: string | null
          event_type?: string | null
          external_event_id?: string
          id?: string
          payload_hash?: string | null
          processed?: boolean
          processed_at?: string | null
          provider?: string
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: []
      }
      pqrs_intake_attempts: {
        Row: {
          action: string
          contact_hash: string | null
          created_at: string
          id: number
          ip_hash: string
        }
        Insert: {
          action?: string
          contact_hash?: string | null
          created_at?: string
          id?: number
          ip_hash: string
        }
        Update: {
          action?: string
          contact_hash?: string | null
          created_at?: string
          id?: number
          ip_hash?: string
        }
        Relationships: []
      }
      pqrs_ticket_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          from_value: string | null
          id: string
          meta: Json
          ticket_id: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          from_value?: string | null
          id?: string
          meta?: Json
          ticket_id: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          from_value?: string | null
          id?: string
          meta?: Json
          ticket_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pqrs_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pqrs_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pqrs_tickets: {
        Row: {
          ai_category: string | null
          ai_priority: string | null
          ai_reply_draft: string | null
          ai_sentiment: string | null
          ai_summary: string | null
          assigned_at: string | null
          assigned_to: string | null
          channel: string
          consent_data_processing: boolean
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          description: string
          due_at: string | null
          duplicate_of: string | null
          first_response_at: string | null
          id: string
          radicado: string | null
          reply_draft_edited: boolean | null
          resolution: string | null
          resolved_at: string | null
          safety_categories: string[]
          safety_level: string
          status: string
          subject: string
          type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_category?: string | null
          ai_priority?: string | null
          ai_reply_draft?: string | null
          ai_sentiment?: string | null
          ai_summary?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          channel?: string
          consent_data_processing?: boolean
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description: string
          due_at?: string | null
          duplicate_of?: string | null
          first_response_at?: string | null
          id?: string
          radicado?: string | null
          reply_draft_edited?: boolean | null
          resolution?: string | null
          resolved_at?: string | null
          safety_categories?: string[]
          safety_level?: string
          status?: string
          subject: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_category?: string | null
          ai_priority?: string | null
          ai_reply_draft?: string | null
          ai_sentiment?: string | null
          ai_summary?: string | null
          assigned_at?: string | null
          assigned_to?: string | null
          channel?: string
          consent_data_processing?: boolean
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string
          due_at?: string | null
          duplicate_of?: string | null
          first_response_at?: string | null
          id?: string
          radicado?: string | null
          reply_draft_edited?: boolean | null
          resolution?: string | null
          resolved_at?: string | null
          safety_categories?: string[]
          safety_level?: string
          status?: string
          subject?: string
          type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pqrs_tickets_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "pqrs_tickets"
            referencedColumns: ["id"]
          },
        ]
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
      professional_identity_documents: {
        Row: {
          created_at: string
          document_enc: string
          document_hash: string
          document_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_enc: string
          document_hash: string
          document_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_enc?: string
          document_hash?: string
          document_type?: string
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
          data_consent_at: string | null
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
          rethus_checked_at: string | null
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
          verification_status: string
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
          data_consent_at?: string | null
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
          rethus_checked_at?: string | null
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
          verification_status?: string
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
          data_consent_at?: string | null
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
          rethus_checked_at?: string | null
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
          verification_status?: string
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
      professional_service_offers: {
        Row: {
          amount: number
          available_from: string
          available_until: string | null
          blocked: boolean
          city: string
          created_at: string
          description: string | null
          id: string
          modality: Database["public"]["Enums"]["offer_modality"]
          professional_id: string
          specialty: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          amount: number
          available_from?: string
          available_until?: string | null
          blocked?: boolean
          city: string
          created_at?: string
          description?: string | null
          id?: string
          modality?: Database["public"]["Enums"]["offer_modality"]
          professional_id: string
          specialty?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number
          available_from?: string
          available_until?: string | null
          blocked?: boolean
          city?: string
          created_at?: string
          description?: string | null
          id?: string
          modality?: Database["public"]["Enums"]["offer_modality"]
          professional_id?: string
          specialty?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      professional_verifications: {
        Row: {
          check_type: string
          created_at: string
          document_hash: string
          id: string
          provider: string
          requested_by: string | null
          result: Json
          reverified: boolean
          status: string
          user_id: string
        }
        Insert: {
          check_type?: string
          created_at?: string
          document_hash: string
          id?: string
          provider?: string
          requested_by?: string | null
          result?: Json
          reverified?: boolean
          status: string
          user_id: string
        }
        Update: {
          check_type?: string
          created_at?: string
          document_hash?: string
          id?: string
          provider?: string
          requested_by?: string | null
          result?: Json
          reverified?: boolean
          status?: string
          user_id?: string
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
          job_offer_shift_id: string | null
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
          job_offer_shift_id?: string | null
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
          job_offer_shift_id?: string | null
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
      service_rating_dimensions: {
        Row: {
          booking_id: string
          created_at: string
          id: string
          rated_id: string
          rater_id: string
          rater_role: string
          scores: Json
        }
        Insert: {
          booking_id: string
          created_at?: string
          id?: string
          rated_id: string
          rater_id: string
          rater_role: string
          scores: Json
        }
        Update: {
          booking_id?: string
          created_at?: string
          id?: string
          rated_id?: string
          rater_id?: string
          rater_role?: string
          scores?: Json
        }
        Relationships: [
          {
            foreignKeyName: "service_rating_dimensions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
        ]
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
          expires_at: string | null
          family_need_id: string | null
          family_user_id: string
          hourly_rate: number
          id: string
          message: string | null
          parent_proposal_id: string | null
          posted_rate: number | null
          professional_id: string
          proposed_by: Database["public"]["Enums"]["slot_proposal_proposed_by"]
          round_no: number
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
          expires_at?: string | null
          family_need_id?: string | null
          family_user_id: string
          hourly_rate?: number
          id?: string
          message?: string | null
          parent_proposal_id?: string | null
          posted_rate?: number | null
          professional_id: string
          proposed_by: Database["public"]["Enums"]["slot_proposal_proposed_by"]
          round_no?: number
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
          expires_at?: string | null
          family_need_id?: string | null
          family_user_id?: string
          hourly_rate?: number
          id?: string
          message?: string | null
          parent_proposal_id?: string | null
          posted_rate?: number | null
          professional_id?: string
          proposed_by?: Database["public"]["Enums"]["slot_proposal_proposed_by"]
          round_no?: number
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
          {
            foreignKeyName: "slot_proposals_parent_proposal_id_fkey"
            columns: ["parent_proposal_id"]
            isOneToOne: false
            referencedRelation: "slot_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_contract_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          contract_id: string
          created_at: string
          data: Json
          event: string
          hash: string
          id: number
          prev_hash: string
          seq: number
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          contract_id: string
          created_at?: string
          data?: Json
          event: string
          hash: string
          id?: number
          prev_hash: string
          seq: number
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          contract_id?: string
          created_at?: string
          data?: Json
          event?: string
          hash?: string
          id?: number
          prev_hash?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "smart_contract_events_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "smart_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_contract_shifts: {
        Row: {
          amount: number
          booking_id: string | null
          contract_id: string
          ends_at: string
          hours: number
          id: string
          job_offer_shift_id: string | null
          shift_no: number
          starts_at: string
          status: string
        }
        Insert: {
          amount: number
          booking_id?: string | null
          contract_id: string
          ends_at: string
          hours: number
          id?: string
          job_offer_shift_id?: string | null
          shift_no: number
          starts_at: string
          status?: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          contract_id?: string
          ends_at?: string
          hours?: number
          id?: string
          job_offer_shift_id?: string | null
          shift_no?: number
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_contract_shifts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "service_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_contract_shifts_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "smart_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_contract_signatures: {
        Row: {
          accepted_clauses: string[]
          body_hash: string
          contract_id: string
          id: string
          identity_evidence: Json
          identity_method: string
          ip_hash: string | null
          party: string
          signature_hash: string
          signed_at: string
          signer_id: string
          signer_identity: string
          signer_name: string
          step_up: Json
          terms_hash: string
          user_agent: string | null
        }
        Insert: {
          accepted_clauses: string[]
          body_hash: string
          contract_id: string
          id?: string
          identity_evidence?: Json
          identity_method: string
          ip_hash?: string | null
          party: string
          signature_hash: string
          signed_at?: string
          signer_id: string
          signer_identity: string
          signer_name: string
          step_up: Json
          terms_hash: string
          user_agent?: string | null
        }
        Update: {
          accepted_clauses?: string[]
          body_hash?: string
          contract_id?: string
          id?: string
          identity_evidence?: Json
          identity_method?: string
          ip_hash?: string | null
          party?: string
          signature_hash?: string
          signed_at?: string
          signer_id?: string
          signer_identity?: string
          signer_name?: string
          step_up?: Json
          terms_hash?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "smart_contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "smart_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_contracts: {
        Row: {
          activated_at: string | null
          application_id: string | null
          closed_at: string | null
          contract_no: string
          created_at: string
          id: string
          institution_user_id: string
          job_offer_id: string | null
          professional_id: string
          signature_deadline: string
          status: string
          template_version: string
          terms: Json
          terms_hash: string
          total_amount: number
          updated_at: string
          version: number
        }
        Insert: {
          activated_at?: string | null
          application_id?: string | null
          closed_at?: string | null
          contract_no: string
          created_at?: string
          id?: string
          institution_user_id: string
          job_offer_id?: string | null
          professional_id: string
          signature_deadline: string
          status?: string
          template_version: string
          terms: Json
          terms_hash: string
          total_amount: number
          updated_at?: string
          version?: number
        }
        Update: {
          activated_at?: string | null
          application_id?: string | null
          closed_at?: string | null
          contract_no?: string
          created_at?: string
          id?: string
          institution_user_id?: string
          job_offer_id?: string | null
          professional_id?: string
          signature_deadline?: string
          status?: string
          template_version?: string
          terms?: Json
          terms_hash?: string
          total_amount?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "smart_contracts_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_contracts_job_offer_id_fkey"
            columns: ["job_offer_id"]
            isOneToOne: false
            referencedRelation: "job_offers"
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
      user_locations: {
        Row: {
          is_online: boolean
          last_seen: string
          lat: number | null
          lng: number | null
          updated_at: string
          user_id: string
          user_type: string | null
        }
        Insert: {
          is_online?: boolean
          last_seen?: string
          lat?: number | null
          lng?: number | null
          updated_at?: string
          user_id: string
          user_type?: string | null
        }
        Update: {
          is_online?: boolean
          last_seen?: string
          lat?: number | null
          lng?: number | null
          updated_at?: string
          user_id?: string
          user_type?: string | null
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
      validation_otps: {
        Row: {
          attempts: number
          channel: string
          code: string | null
          code_hash: string | null
          contact: string
          created_at: string
          expires_at: string
          id: string
          ip_hash: string | null
          response_id: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          channel: string
          code?: string | null
          code_hash?: string | null
          contact: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          response_id?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          code?: string | null
          code_hash?: string | null
          contact?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_hash?: string | null
          response_id?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "validation_otps_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "validation_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_responses: {
        Row: {
          alternatives: string[]
          benefit_expires_at: string | null
          benefit_plan: string
          benefit_status: string
          city: string | null
          comments: string | null
          competitors: string | null
          consent_at: string | null
          consent_version: string | null
          contact_key: string | null
          contact_verified_at: string | null
          created_at: string
          current_solutions: string | null
          email: string | null
          full_name: string | null
          id: string
          ip_hash: string | null
          key_benefit: string | null
          pain_point: string | null
          pays_currently: string | null
          premium_activated: boolean | null
          profile_type: string
          promo_code: string | null
          quality_flags: string[]
          redeemed_at: string | null
          redeemed_by: string | null
          retention_channels: string | null
          score_benefit: number | null
          score_clear_problem: number | null
          score_competitive_adv: number | null
          score_demand: number | null
          score_passion: number | null
          score_reach: number | null
          search_channels: string[]
          service_offer: string | null
          signal_score: number | null
          source: string | null
          target_customer: string | null
          total_score: number | null
          user_id: string | null
          verified_channel: string | null
          whatsapp: string | null
          willingness_pct: number | null
        }
        Insert: {
          alternatives?: string[]
          benefit_expires_at?: string | null
          benefit_plan?: string
          benefit_status?: string
          city?: string | null
          comments?: string | null
          competitors?: string | null
          consent_at?: string | null
          consent_version?: string | null
          contact_key?: string | null
          contact_verified_at?: string | null
          created_at?: string
          current_solutions?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          ip_hash?: string | null
          key_benefit?: string | null
          pain_point?: string | null
          pays_currently?: string | null
          premium_activated?: boolean | null
          profile_type?: string
          promo_code?: string | null
          quality_flags?: string[]
          redeemed_at?: string | null
          redeemed_by?: string | null
          retention_channels?: string | null
          score_benefit?: number | null
          score_clear_problem?: number | null
          score_competitive_adv?: number | null
          score_demand?: number | null
          score_passion?: number | null
          score_reach?: number | null
          search_channels?: string[]
          service_offer?: string | null
          signal_score?: number | null
          source?: string | null
          target_customer?: string | null
          total_score?: number | null
          user_id?: string | null
          verified_channel?: string | null
          whatsapp?: string | null
          willingness_pct?: number | null
        }
        Update: {
          alternatives?: string[]
          benefit_expires_at?: string | null
          benefit_plan?: string
          benefit_status?: string
          city?: string | null
          comments?: string | null
          competitors?: string | null
          consent_at?: string | null
          consent_version?: string | null
          contact_key?: string | null
          contact_verified_at?: string | null
          created_at?: string
          current_solutions?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          ip_hash?: string | null
          key_benefit?: string | null
          pain_point?: string | null
          pays_currently?: string | null
          premium_activated?: boolean | null
          profile_type?: string
          promo_code?: string | null
          quality_flags?: string[]
          redeemed_at?: string | null
          redeemed_by?: string | null
          retention_channels?: string | null
          score_benefit?: number | null
          score_clear_problem?: number | null
          score_competitive_adv?: number | null
          score_demand?: number | null
          score_passion?: number | null
          score_reach?: number | null
          search_channels?: string[]
          service_offer?: string | null
          signal_score?: number | null
          source?: string | null
          target_customer?: string | null
          total_score?: number | null
          user_id?: string | null
          verified_channel?: string | null
          whatsapp?: string | null
          willingness_pct?: number | null
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
      accept_application: {
        Args: { p_application_id: string; p_shifts?: Json }
        Returns: Json
      }
      accept_slot_proposal: { Args: { p_proposal_id: string }; Returns: string }
      ad_track: { Args: { _id: string; _kind: string }; Returns: undefined }
      ai_credits_monthly_allowance: {
        Args: { p_user_id: string }
        Returns: number
      }
      append_contract_event: {
        Args: {
          p_actor: string
          p_contract: string
          p_data?: Json
          p_event: string
          p_role: string
        }
        Returns: undefined
      }
      apply_to_family_need: {
        Args: { p_message?: string; p_need_ids: string[]; p_rate?: number }
        Returns: string
      }
      apply_to_offer: {
        Args: {
          p_amount?: number
          p_message?: string
          p_offer_id: string
          p_shift_ids?: string[]
        }
        Returns: string
      }
      booking_commission_pct: {
        Args: { p_client: string; p_professional: string }
        Returns: number
      }
      care_can_view: {
        Args: { p_booking_id: string; p_user: string }
        Returns: boolean
      }
      care_history_report: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          alerts: number
          booking_id: string
          ended_at: string
          events: number
          incidents: number
          kudos_sent: boolean
          last_mood: string
          offer_title: string
          planned_hours: number
          professional: string
          scheduled_at: string
          specialty: string
          started_at: string
          status: string
          vitals: number
        }[]
      }
      care_report: { Args: { p_booking_id: string }; Returns: Json }
      care_watchers: {
        Args: { p_client: string }
        Returns: {
          is_owner: boolean
          watcher_id: string
        }[]
      }
      career_stats_core: { Args: { p_user: string }; Returns: Json }
      city_key: { Args: { p_city: string }; Returns: string }
      consume_ai_credits: {
        Args: {
          p_amount?: number
          p_feature: string
          p_meta?: Json
          p_user_id: string
        }
        Returns: {
          created_at: string
          credits_used: number
          feature: string
          id: string
          meta: Json | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_credits_ledger"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_reveal_quota: {
        Args: { p_counterpart: string; p_offer: string; p_pro: string }
        Returns: number
      }
      contract_event_hash: {
        Args: {
          p_actor: string
          p_at: string
          p_data: Json
          p_event: string
          p_prev: string
          p_role: string
          p_seq: number
        }
        Returns: string
      }
      contract_signature_hash: {
        Args: {
          p_at: string
          p_body_hash: string
          p_contract: string
          p_party: string
          p_signer: string
          p_step_up: Json
          p_terms_hash: string
        }
        Returns: string
      }
      contract_signer_readiness: {
        Args: { p_contract_id: string; p_user: string }
        Returns: Json
      }
      counter_application: {
        Args: { p_amount: number; p_application_id: string; p_message?: string }
        Returns: number
      }
      counter_slot_proposal: {
        Args: { p_message?: string; p_proposal_id: string; p_rate: number }
        Returns: string
      }
      create_contract_for_application: {
        Args: { p_application_id: string; p_pairs: Json }
        Returns: string
      }
      decline_application: {
        Args: { p_application_id: string; p_note?: string }
        Returns: undefined
      }
      decline_contract: {
        Args: { p_contract_id: string; p_reason?: string }
        Returns: undefined
      }
      default_contract_conditions: { Args: never; Returns: Json }
      expire_stale_applications: { Args: never; Returns: number }
      expire_stale_contracts: { Args: never; Returns: number }
      expire_stale_proposals: { Args: never; Returns: number }
      family_applicants: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          awaiting: string
          booking_id: string
          can_negotiate: boolean
          can_reveal: boolean
          city: string
          contact_unlocked: boolean
          created_at: string
          display_name: string
          distance_band_km: number
          ends_at: string
          estimated_total: number
          expires_at: string
          family_need_id: string
          has_phone: boolean
          hourly_rate: number
          hours: number
          message: string
          name_is_short: boolean
          parent_proposal_id: string
          plan_key: string
          posted_rate: number
          professional_id: string
          proposal_id: string
          proposed_by: string
          ratings_count: number
          rethus_verified: boolean
          reveals_left: number
          round_no: number
          specialty: string
          stars_avg: number
          starts_at: string
          status: string
          total_jobs: number
          trust_level: string
          trust_score: number
          years_experience: number
        }[]
      }
      family_offer_applicants: {
        Args: { p_limit?: number }
        Returns: {
          application_id: string
          avatar_url: string
          awaiting: string
          can_negotiate: boolean
          can_reveal: boolean
          city: string
          contact_unlocked: boolean
          created_at: string
          display_name: string
          distance_band_km: number
          expires_at: string
          has_phone: boolean
          has_shifts: boolean
          job_offer_id: string
          message: string
          modality: string
          name_is_short: boolean
          offer_end: string
          offer_start: string
          offer_title: string
          plan_key: string
          posted_amount: number
          professional_id: string
          proposed_amount: number
          ratings_count: number
          rethus_verified: boolean
          reveals_left: number
          round_no: number
          specialty: string
          stars_avg: number
          status: string
          total_jobs: number
          trust_level: string
          trust_score: number
          years_experience: number
        }[]
      }
      family_reputation: {
        Args: { p_family: string }
        Returns: {
          completed_services: number
          dimensions: Json
          ratings_count: number
          stars_avg: number
        }[]
      }
      featured_professionals: {
        Args: { p_ids: string[] }
        Returns: {
          user_id: string
        }[]
      }
      find_replacement_candidates: {
        Args: { p_booking_id: string }
        Returns: {
          avatar_url: string
          avg_rating: number
          full_name: string
          hourly_rate: number
          is_favorite: boolean
          specialty: string
          total_jobs: number
          user_id: string
        }[]
      }
      get_ai_credits_balance: {
        Args: { p_user_id: string }
        Returns: {
          allowance: number
          period_end: string
          period_start: string
          remaining: number
          used: number
        }[]
      }
      get_booking_contact: {
        Args: { _booking_id: string }
        Returns: {
          avatar_url: string
          full_name: string
          is_professional: boolean
          peer_id: string
          phone: string
        }[]
      }
      get_care_summary: {
        Args: { p_booking_id: string }
        Returns: {
          arrival_at: string
          departure_at: string
          event_count: number
          has_incident: boolean
          has_vitals: boolean
          last_event_at: string
        }[]
      }
      get_live_counts: {
        Args: never
        Returns: {
          completed_services: number
          fam_available: number
          fam_busy: number
          fam_live: number
          fam_total: number
          inst_available: number
          inst_busy: number
          inst_live: number
          inst_total: number
          pro_available: number
          pro_busy: number
          pro_live: number
          pro_rethus: number
          pro_total: number
        }[]
      }
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
      get_or_create_booking_conversation: {
        Args: { _booking_id: string }
        Returns: string
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
      get_total_ai_credits_balance: {
        Args: { p_user_id: string }
        Returns: {
          extra_remaining: number
          extra_total: number
          extra_used: number
          grand_total: number
          monthly_allowance: number
          monthly_remaining: number
          monthly_used: number
          period_end: string
          period_start: string
        }[]
      }
      get_trust_score: {
        Args: { p_user: string }
        Returns: {
          completed_services: number
          components: Json
          enough_data: boolean
          kind: string
          level: string
          ratings_count: number
          score: number
          source: string
          stars_avg: number
          user_id: string
          verified: boolean
        }[]
      }
      grant_ai_credits: {
        Args: {
          p_credits: number
          p_mp_payment_id?: string
          p_mp_preference_id?: string
          p_pack_id: string
          p_price_cop: number
          p_user_id: string
          p_validity_days?: number
        }
        Returns: {
          created_at: string
          credits: number
          credits_used: number
          expires_at: string
          id: string
          mp_payment_id: string | null
          mp_preference_id: string | null
          pack_id: string | null
          price_cop: number
          source: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ai_credit_topups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hx_acting_institution: {
        Args: { p_module: string; p_uid: string }
        Returns: string
      }
      hx_ai_credits_assert_self: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      hx_ai_month_start: { Args: never; Returns: string }
      hx_ai_monthly_used: { Args: { p_user_id: string }; Returns: number }
      hx_alert_rank: { Args: { p_reason: string }; Returns: number }
      hx_can_access_alert: {
        Args: { p_booking: string; p_patient: string; p_type: string }
        Returns: boolean
      }
      hx_can_track_booking: {
        Args: { p_booking: string; p_uid: string }
        Returns: boolean
      }
      hx_can_trigger_sos: {
        Args: { p_booking: string; p_patient: string }
        Returns: boolean
      }
      hx_care_actor_name: { Args: never; Returns: string }
      hx_care_case_insert: {
        Args: { p_data: Json; p_inst: string; p_patient: string; p_plan: Json }
        Returns: {
          application_id: string | null
          care_type: string
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          institution_id: string
          opened_at: string
          outcome: string | null
          patient_id: string
          priority: string
          professional_id: string | null
          professional_label: string | null
          satisfaction: number | null
          satisfaction_by: string | null
          satisfaction_note: string | null
          status: string
          summary: string | null
          target_end_at: string | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inst_cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hx_care_inst: { Args: { p_module: string }; Returns: string }
      hx_care_log: {
        Args: {
          p_case: string
          p_data?: Json
          p_inst: string
          p_kind: string
          p_patient: string
        }
        Returns: undefined
      }
      hx_care_need: { Args: { p_module: string }; Returns: string }
      hx_care_need_any: { Args: { p_a: string; p_b: string }; Returns: string }
      hx_care_note: {
        Args: {
          p_body: string
          p_case: string
          p_corrects?: string
          p_inst: string
          p_kind: string
          p_patient: string
          p_vitals?: Json
        }
        Returns: {
          author_id: string
          author_name: string
          author_role: string
          body: string
          case_id: string | null
          corrects_note_id: string | null
          created_at: string
          hash: string
          id: string
          institution_id: string
          kind: string
          patient_id: string
          prev_hash: string
          seq: number
          vitals: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "inst_notes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hx_care_notify_team: {
        Args: {
          p_body: string
          p_inst: string
          p_module: string
          p_title: string
          p_type: string
        }
        Returns: undefined
      }
      hx_care_patient: {
        Args: { p_id: string; p_inst: string; p_lock?: boolean }
        Returns: {
          address: string | null
          allergies: string[]
          birth_date: string | null
          city: string | null
          conditions: string[]
          consent_confirmed_at: string
          consent_confirmed_by: string
          created_at: string
          created_by: string
          discharged_at: string | null
          document_number: string | null
          document_type: string | null
          emergency_name: string | null
          emergency_phone: string | null
          eps_name: string | null
          external_ref: string | null
          family_updates_ok: boolean
          full_name: string
          id: string
          institution_id: string
          modality: string
          monitoring: boolean
          monitoring_since: string | null
          room: string | null
          sex: string | null
          spo2_scale: number
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "inst_patients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      hx_care_plan: { Args: { p_inst: string }; Returns: Json }
      hx_cell: { Args: { p: number; p_size?: number }; Returns: number }
      hx_circle_limit: { Args: { p_plan: string }; Returns: number }
      hx_cop: { Args: { p_amount: number }; Returns: string }
      hx_dashboard_link: { Args: { p_user: string }; Returns: string }
      hx_distance_band: { Args: { p_km: number }; Returns: number }
      hx_distance_km: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      hx_duration_label: { Args: { p_minutes: number }; Returns: string }
      hx_free_commission_pct: { Args: never; Returns: number }
      hx_ingest_ip_hash: { Args: never; Returns: string }
      hx_inst_alert_autoresolve: {
        Args: { p_at: string; p_obs: string; p_patient: string }
        Returns: undefined
      }
      hx_inst_alert_raise: {
        Args: {
          p_inst: string
          p_msg: string
          p_news2: number
          p_obs: string
          p_patient: string
          p_reason: string
          p_sev: string
        }
        Returns: undefined
      }
      hx_inst_care_limits: { Args: { p_plan: string }; Returns: Json }
      hx_inst_escalate: { Args: { p_inst: string }; Returns: number }
      hx_inst_escalate_all: { Args: never; Returns: number }
      hx_inst_note_payload: {
        Args: {
          p_at: string
          p_author: string
          p_body: string
          p_kind: string
          p_patient: string
          p_prev: string
          p_seq: number
          p_vitals: Json
        }
        Returns: string
      }
      hx_inst_purge_all: { Args: never; Returns: number }
      hx_inst_purge_device_obs: { Args: { p_inst: string }; Returns: number }
      hx_inst_purge_failures: { Args: never; Returns: number }
      hx_json_num: { Args: { p: Json; p_key: string }; Returns: number }
      hx_json_texts: { Args: { p: Json }; Returns: string[] }
      hx_member_can: {
        Args: { p_institution: string; p_module: string }
        Returns: boolean
      }
      hx_name_ok: {
        Args: { p: string; p_max: number; p_min: number }
        Returns: boolean
      }
      hx_news2: {
        Args: {
          p_avpu: string
          p_hr: number
          p_on_o2: boolean
          p_rr: number
          p_sbp: number
          p_scale?: number
          p_spo2: number
          p_temp: number
        }
        Returns: Json
      }
      hx_news2_band: {
        Args: { p_max_single: number; p_score: number }
        Returns: string
      }
      hx_news2_interval_min: {
        Args: { p_max_single: number; p_score: number }
        Returns: number
      }
      hx_notify: {
        Args: {
          p_body: string
          p_link: string
          p_title: string
          p_type: string
          p_user: string
        }
        Returns: undefined
      }
      hx_notify_ex: {
        Args: {
          p_body: string
          p_link: string
          p_meta: Json
          p_title: string
          p_type: string
          p_user: string
        }
        Returns: boolean
      }
      hx_notify_nearby_professionals: {
        Args: {
          p_body: string
          p_city: string
          p_kind: string
          p_lat: number
          p_lng: number
          p_meta: Json
          p_poster: string
          p_title: string
        }
        Returns: number
      }
      hx_offer_text_issue: {
        Args: { p_require_care?: boolean; p_text: string }
        Returns: string
      }
      hx_paid_plans: { Args: never; Returns: string[] }
      hx_ping_map: { Args: never; Returns: undefined }
      hx_ping_service_offers: { Args: never; Returns: undefined }
      hx_plan_visibility_boost: { Args: { p_user: string }; Returns: number }
      hx_presence_ttl: { Args: never; Returns: string }
      hx_pro_docs_complete: { Args: { p_uid: string }; Returns: boolean }
      hx_pro_label: {
        Args: { p_full_name: string; p_short: boolean }
        Returns: string
      }
      hx_reveal_pro_contact: {
        Args: {
          p_application: string
          p_family: string
          p_pro: string
          p_proposal: string
        }
        Returns: {
          city: string
          full_name: string
          phone: string
          revealed_at: string
          reveals_left: number
          whatsapp: string
        }[]
      }
      hx_sha256: { Args: { p_text: string }; Returns: string }
      hx_sos_audience: {
        Args: { p_booking: string; p_exclude: string; p_patient: string }
        Returns: {
          user_id: string
        }[]
      }
      hx_staff_modules: { Args: never; Returns: string[] }
      hx_text_array_ok: {
        Args: { p: string[]; p_items: number; p_len: number }
        Returns: boolean
      }
      hx_text_norm: { Args: { p: string }; Returns: string }
      hx_text_ok: { Args: { p: string; p_max: number }; Returns: boolean }
      hx_trust_calc: {
        Args: { p_kind?: string; p_user: string }
        Returns: {
          completed_services: number
          components: Json
          enough_data: boolean
          kind: string
          level: string
          ratings_count: number
          score: number
          source: string
          stars_avg: number
          verified: boolean
        }[]
      }
      hx_trust_level: { Args: { p_score: number }; Returns: string }
      inst_accepted_applications: {
        Args: never
        Returns: {
          accepted_at: string
          application_id: string
          offer_id: string
          offer_title: string
          professional_id: string
          professional_label: string
          proposed_amount: number
        }[]
      }
      inst_alert_ack: { Args: { p_id: string; p_note?: string }; Returns: Json }
      inst_alert_resolve: {
        Args: { p_id: string; p_note?: string; p_resolution: string }
        Returns: Json
      }
      inst_care_overview: { Args: never; Returns: Json }
      inst_case_close: {
        Args: {
          p_by?: string
          p_id: string
          p_note?: string
          p_outcome?: string
          p_satisfaction?: number
          p_status: string
        }
        Returns: Json
      }
      inst_case_open: {
        Args: { p_data: Json; p_patient: string }
        Returns: Json
      }
      inst_case_rate: {
        Args: {
          p_by?: string
          p_id: string
          p_note?: string
          p_satisfaction: number
        }
        Returns: Json
      }
      inst_case_update: { Args: { p_data: Json; p_id: string }; Returns: Json }
      inst_device_create: {
        Args: { p_kind?: string; p_label: string; p_patient: string }
        Returns: Json
      }
      inst_device_ingest: {
        Args: { p_code: string; p_reading: Json }
        Returns: Json
      }
      inst_device_revoke: { Args: { p_id: string }; Returns: Json }
      inst_escalate_due: { Args: never; Returns: number }
      inst_export_log: {
        Args: { p_format: string; p_patient: string }
        Returns: undefined
      }
      inst_handoff_commit: { Args: { p_items: Json }; Returns: Json }
      inst_monitoring_set: {
        Args: { p_modality?: string; p_on: boolean; p_patient: string }
        Returns: Json
      }
      inst_note_add: {
        Args: {
          p_body: string
          p_case?: string
          p_corrects?: string
          p_kind: string
          p_patient: string
          p_vitals?: Json
        }
        Returns: Json
      }
      inst_patient_create: {
        Args: {
          p_case?: Json
          p_consent: boolean
          p_data: Json
          p_monitor?: boolean
        }
        Returns: Json
      }
      inst_patient_discharge: {
        Args: { p_id: string; p_note?: string; p_outcome?: string }
        Returns: Json
      }
      inst_patient_set_scale: {
        Args: { p_id: string; p_reason?: string; p_scale: number }
        Returns: Json
      }
      inst_patient_set_status: {
        Args: { p_id: string; p_status: string }
        Returns: Json
      }
      inst_patient_update: {
        Args: { p_data: Json; p_id: string }
        Returns: Json
      }
      inst_task_add: {
        Args: {
          p_case?: string
          p_due_at?: string
          p_kind?: string
          p_patient: string
          p_title: string
        }
        Returns: Json
      }
      inst_task_done: {
        Args: { p_id: string; p_status?: string }
        Returns: Json
      }
      inst_verify_notes: { Args: { p_patient: string }; Returns: Json }
      inst_vitals_record: {
        Args: { p_data: Json; p_patient: string }
        Returns: Json
      }
      institution_application_inbox: {
        Args: { p_limit?: number }
        Returns: {
          accepted_at: string
          agreed_amount: number
          application_id: string
          avg_rating: number
          awaiting: string
          closed_reason: string
          contract_id: string
          contract_status: string
          created_at: string
          expires_at: string
          job_offer_id: string
          jobs_with_me: number
          message: string
          modality: string
          offer_title: string
          posted_amount: number
          professional_avatar: string
          professional_city: string
          professional_id: string
          professional_name: string
          profile_verified: boolean
          proposed_amount: number
          rethus_verified: boolean
          round_no: number
          shifts: Json
          specialty: string
          status: string
          total_jobs: number
          years_experience: number
        }[]
      }
      institution_reputation: {
        Args: { p_institution: string }
        Returns: {
          completed_services: number
          dimensions: Json
          ratings_count: number
          stars_avg: number
        }[]
      }
      invite_matching_professionals: {
        Args: { p_offer_id: string; p_user_ids: string[] }
        Returns: number
      }
      invite_team_core: {
        Args: {
          p_auto?: boolean
          p_exclude?: string
          p_inviter: string
          p_offer: string
        }
        Returns: number
      }
      invite_team_to_offer: { Args: { p_offer_id: string }; Returns: number }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      kudos_allowed_kinds: { Args: { p_from_role: string }; Returns: string[] }
      list_open_family_needs: {
        Args: { p_limit?: number }
        Returns: {
          already_applied: boolean
          care_type: string
          city: string
          created_at: string
          display_name: string
          distance_band_km: number
          ends_at: string
          family_completed: number
          family_ratings: number
          family_stars: number
          family_trust: number
          family_trust_enough: boolean
          family_trust_level: string
          family_user_id: string
          family_verified: boolean
          hourly_rate: number
          id: string
          notes_public: string
          starts_at: string
        }[]
      }
      list_open_family_offers: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          city: string
          created_at: string
          description: string
          display_name: string
          distance_band_km: number
          end_date: string
          family_completed: number
          family_ratings: number
          family_stars: number
          family_trust: number
          family_trust_enough: boolean
          family_trust_level: string
          family_user_id: string
          family_verified: boolean
          is_urgent: boolean
          modality: string
          my_amount: number
          my_application_id: string
          my_awaiting: string
          my_status: string
          offer_id: string
          requirements: string[]
          specialty_required: string
          start_date: string
          title: string
        }[]
      }
      list_open_institution_offers: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          city: string
          completed_services: number
          created_at: string
          description: string
          distance_band_km: number
          end_date: string
          institution_name: string
          institution_trust: number
          institution_trust_enough: boolean
          institution_trust_level: string
          institution_type: string
          institution_user_id: string
          institution_verified: boolean
          is_urgent: boolean
          lat: number
          lng: number
          modality: string
          my_amount: number
          my_application_id: string
          my_awaiting: string
          my_status: string
          offer_id: string
          positions_filled: number
          positions_total: number
          rating_avg: number
          rating_count: number
          requirements: string[]
          service_area: string
          shifts: Json
          specialty_required: string
          start_date: string
          title: string
        }[]
      }
      list_open_service_offers: {
        Args: { p_limit?: number }
        Returns: {
          amount: number
          availability_status: string
          available_from: string
          available_until: string
          avatar_url: string
          avg_rating: number
          city: string
          created_at: string
          description: string
          display_name: string
          distance_band_km: number
          live: boolean
          modality: string
          offer_id: string
          professional_id: string
          profile_specialty: string
          rethus_verified: boolean
          specialty: string
          title: string
          total_jobs: number
          trust_enough: boolean
          trust_level: string
          trust_score: number
          verified: boolean
        }[]
      }
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
      map_institutions: {
        Args: { p_limit?: number }
        Returns: {
          city: string
          inst_id: string
          institution_type: string
          lat: number
          live: boolean
          lng: number
          name: string
          open_offers: number
          status: string
          verification_status: string
          verified: boolean
        }[]
      }
      map_open_demand: {
        Args: {
          p_lat?: number
          p_limit?: number
          p_lng?: number
          p_radius_km?: number
        }
        Returns: {
          city: string
          display_name: string
          distance_band: number
          is_urgent: boolean
          lat: number
          lng: number
          offer_id: string
          open_hours: number
          open_offers: number
          poster_id: string
          poster_kind: string
          top_hourly: number
          trust_enough: boolean
          trust_level: string
          trust_score: number
          verification_status: string
        }[]
      }
      map_professionals: {
        Args: {
          p_lat?: number
          p_limit?: number
          p_lng?: number
          p_radius_km?: number
        }
        Returns: {
          avatar_url: string
          avg_rating: number
          display_name: string
          gender: string
          home_city: string
          hourly_rate: number
          last_seen: string
          lat: number
          live: boolean
          lng: number
          pro_id: string
          rethus_verified: boolean
          specialty: string
          status: string
          sub_specialties: string[]
          trust_score: number
          verification_status: string
          verified: boolean
          years_experience: number
        }[]
      }
      market_rate_stats: {
        Args: { p_city?: string }
        Returns: {
          median: number
          n: number
          p25: number
          p75: number
        }[]
      }
      market_supply_snapshot: {
        Args: { p_city?: string; p_specialty?: string }
        Returns: {
          professionals: number
          rethus_verified: number
        }[]
      }
      marketplace_city_balance: {
        Args: never
        Returns: {
          city_key: string
          city_label: string
          offers_30d: number
          open_offers: number
          professionals_available: number
          professionals_published: number
        }[]
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
      message_has_forbidden_content: {
        Args: { p_text: string }
        Returns: boolean
      }
      moderate_offer: {
        Args: { p_action: string; p_offer_id: string; p_reason?: string }
        Returns: undefined
      }
      my_active_services: {
        Args: { p_limit?: number }
        Returns: {
          alerts: number
          booking_id: string
          counterpart_id: string
          counterpart_name: string
          duration_hours: number
          events: number
          last_mood: string
          last_vitals: Json
          owner_name: string
          scheduled_at: string
          side: string
          started_at: string
          status: string
        }[]
      }
      my_booking_commission_pct: {
        Args: { p_professional: string }
        Returns: number
      }
      my_career_stats: { Args: never; Returns: Json }
      my_circle_quota: {
        Args: never
        Returns: {
          circle_limit: number
          plan: string
          used: number
        }[]
      }
      my_offer_applications: {
        Args: { p_limit?: number }
        Returns: {
          accepted_at: string
          agreed_amount: number
          application_id: string
          awaiting: string
          booking_ids: string[]
          city: string
          closed_reason: string
          contract_id: string
          contract_status: string
          created_at: string
          expires_at: string
          i_signed: boolean
          institution_id: string
          institution_name: string
          job_offer_id: string
          modality: string
          offer_title: string
          other_signed: boolean
          posted_amount: number
          proposed_amount: number
          round_no: number
          shifts: Json
          status: string
        }[]
      }
      my_pqrs_tickets: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          due_at: string
          first_response_at: string
          id: string
          radicado: string
          resolution: string
          resolved_at: string
          status: string
          subject: string
          type: string
        }[]
      }
      my_received_kudos: {
        Args: { p_limit?: number }
        Returns: {
          booking_id: string
          created_at: string
          from_name: string
          from_role: string
          id: string
          kinds: string[]
          message: string
        }[]
      }
      my_slot_proposals: {
        Args: { p_limit?: number }
        Returns: {
          booking_id: string
          created_at: string
          decision_note: string
          ends_at: string
          expires_at: string
          family_need_id: string
          family_user_id: string
          hourly_rate: number
          id: string
          message: string
          parent_proposal_id: string
          peer_avatar: string
          peer_city: string
          peer_id: string
          peer_name: string
          posted_rate: number
          professional_id: string
          proposed_by: string
          round_no: number
          starts_at: string
          status: string
        }[]
      }
      my_smart_contracts: {
        Args: { p_limit?: number }
        Returns: {
          contract_id: string
          contract_no: string
          counterpart_name: string
          created_at: string
          first_booking_id: string
          first_shift: string
          i_signed: boolean
          my_party: string
          offer_title: string
          other_signed: boolean
          shifts: number
          signature_deadline: string
          status: string
          total_amount: number
          version: number
        }[]
      }
      my_sos_alerts: {
        Args: { p_limit?: number }
        Returns: {
          acknowledged_at: string
          acknowledged_by_name: string
          created_at: string
          id: string
          inapp_notified: number
          lat: number
          lng: number
          mine: boolean
          notified_whatsapp: boolean
          patient_id: string
          patient_name: string
          resolved_at: string
          status: string
          triggered_by_name: string
        }[]
      }
      my_staff_context: {
        Args: never
        Returns: {
          display_name: string
          institution_city: string
          institution_id: string
          institution_name: string
          job_title: string
          member_id: string
          modules: string[]
          plan_active: boolean
          status: string
          username: string
        }[]
      }
      my_trusted_team: {
        Args: never
        Returns: {
          available: boolean
          avatar_url: string
          avg_rating: number
          display_name: string
          favorite_since: string
          last_service_at: string
          professional_id: string
          services_together: number
          specialty: string
        }[]
      }
      notify_edge_function: {
        Args: { fn_name: string; payload: Json }
        Returns: undefined
      }
      notify_offer_alerts: { Args: { p_offer: string }; Returns: number }
      offer_band_max: {
        Args: { p_modality: string; p_posted: number }
        Returns: number
      }
      offer_band_min: {
        Args: { p_modality: string; p_posted: number }
        Returns: number
      }
      party_display_name: { Args: { p_user: string }; Returns: string }
      plan_key_for: { Args: { p_user: string }; Returns: string }
      plan_tier_rank: { Args: { _plan: string }; Returns: number }
      platform_commission_pct: { Args: { p_user_id: string }; Returns: number }
      professional_dimension_averages: {
        Args: { p_user: string }
        Returns: {
          average: number
          dimension: string
          ratings: number
        }[]
      }
      professional_kudos_summary: {
        Args: { p_user: string }
        Returns: {
          givers: number
          kind: string
        }[]
      }
      professional_public_stats: { Args: { p_user: string }; Returns: Json }
      public_professionals: {
        Args: {
          p_city?: string
          p_ids?: string[]
          p_limit?: number
          p_max_rate?: number
          p_min_rate?: number
          p_min_rating?: number
          p_specialty?: string
          p_verified?: boolean
        }
        Returns: {
          active: boolean
          ai_strengths: string[]
          ai_summary: string
          availability: Json
          availability_status: string
          available: boolean
          avatar_url: string
          avg_rating: number
          bio: string
          certifications: Json
          full_name: string
          gender: string
          home_city: string
          hourly_rate: number
          languages: string[]
          lat: number
          live: boolean
          lng: number
          monthly_rate: number
          published: boolean
          reserved_until: string
          rethus_number: string
          rethus_verified: boolean
          service_cities: string[]
          shift_rate: number
          specialty: string
          sub_specialties: string[]
          total_jobs: number
          trust_score: number
          user_id: string
          verified: boolean
          work_experience: Json
          years_experience: number
        }[]
      }
      publish_institution_offer: { Args: { p_offer: Json }; Returns: string }
      publish_profile: { Args: { _validation_id?: string }; Returns: Json }
      rate_band_max: { Args: { p_posted: number }; Returns: number }
      rate_band_min: { Args: { p_posted: number }; Returns: number }
      record_contract_signature: {
        Args: {
          p_accepted_clauses: string[]
          p_body_hash: string
          p_contract_id: string
          p_ip_hash: string
          p_signer_id: string
          p_step_up: Json
          p_terms_hash: string
          p_user_agent: string
        }
        Returns: Json
      }
      redact_contact_info: { Args: { p_text: string }; Returns: string }
      redeem_staff_invitation: {
        Args: { _token: string }
        Returns: {
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      redeem_validation_benefit: {
        Args: { p_code: string; p_user: string }
        Returns: Json
      }
      release_expired_reservations: { Args: never; Returns: undefined }
      respond_circle_invitation: {
        Args: { p_accept: boolean; p_id: string }
        Returns: undefined
      }
      reveal_applicant_contact: {
        Args: { p_proposal_id: string }
        Returns: {
          city: string
          full_name: string
          phone: string
          revealed_at: string
          reveals_left: number
          whatsapp: string
        }[]
      }
      reveal_application_contact: {
        Args: { p_application_id: string }
        Returns: {
          city: string
          full_name: string
          phone: string
          revealed_at: string
          reveals_left: number
          whatsapp: string
        }[]
      }
      reveal_daily_quota: { Args: { p_plan: string }; Returns: number }
      reveal_offer_contact: {
        Args: { p_application_id: string }
        Returns: {
          access_notes: string
          address: string
          city: string
          counterpart_name: string
          phone: string
          revealed_at: string
          reveals_left: number
          whatsapp: string
        }[]
      }
      reveal_opportunity_contact: {
        Args: { p_need_id: string }
        Returns: {
          address: string
          city: string
          full_name: string
          phone: string
          revealed_at: string
          reveals_left: number
          whatsapp: string
        }[]
      }
      send_kudos: {
        Args: { p_booking_id: string; p_kinds: string[]; p_message?: string }
        Returns: string
      }
      set_offer_reserved: {
        Args: { _offer_id: string; _professional_id: string }
        Returns: undefined
      }
      short_display_name: { Args: { p_full_name: string }; Returns: string }
      sign_contract: {
        Args: { p_contract_id: string; p_otp: string; p_party: string }
        Returns: boolean
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
      stop_presence: { Args: never; Returns: undefined }
      suggest_professionals_for_offer: {
        Args: { p_limit?: number; p_offer_id: string }
        Returns: {
          available: boolean
          avatar_url: string
          avg_rating: number
          final_score: number
          full_name: string
          home_city: string
          hourly_rate: number
          matches_specialty: boolean
          rethus_verified: boolean
          rule_score: number
          serves_city: boolean
          similarity: number
          source: string
          specialty: string
          total_jobs: number
          user_id: string
        }[]
      }
      touch_presence: {
        Args: { p_lat?: number; p_lng?: number }
        Returns: undefined
      }
      trusted_team_free_count: {
        Args: {
          p_client: string
          p_end: string
          p_exclude?: string
          p_start: string
        }
        Returns: number
      }
      update_contract_conditions: {
        Args: { p_conditions: Json; p_contract_id: string }
        Returns: string
      }
      verify_contract_integrity: {
        Args: { p_contract_id: string }
        Returns: Json
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
      wearable_ingest_by_pairing_code_core: {
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
        | "countered"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
        "countered",
      ],
      subscription_plan: ["free", "pro", "family", "institution"],
      subscription_status: ["active", "cancelled", "past_due", "trialing"],
      testimonial_role: ["professional", "family", "institution"],
      testimonial_status: ["pending", "published", "rejected"],
    },
  },
} as const
