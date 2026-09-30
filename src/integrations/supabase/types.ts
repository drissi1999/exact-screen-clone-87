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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_drafts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_text: string | null
          case_id: string
          confidentiality: Database["public"]["Enums"]["confidentiality"]
          created_at: string
          created_by: string | null
          draft_text: string
          id: string
          kind: string
          required_role: string
          status: Database["public"]["Enums"]["review_status"]
          tenant_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_text?: string | null
          case_id: string
          confidentiality: Database["public"]["Enums"]["confidentiality"]
          created_at?: string
          created_by?: string | null
          draft_text: string
          id?: string
          kind: string
          required_role?: string
          status?: Database["public"]["Enums"]["review_status"]
          tenant_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_text?: string | null
          case_id?: string
          confidentiality?: Database["public"]["Enums"]["confidentiality"]
          created_at?: string
          created_by?: string | null
          draft_text?: string
          id?: string
          kind?: string
          required_role?: string
          status?: Database["public"]["Enums"]["review_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_drafts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at: string | null
          revoked: boolean
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          label: string
          last_used_at?: string | null
          revoked?: boolean
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          label?: string
          last_used_at?: string | null
          revoked?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          case_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: number
          tenant_id: string
          user_id: string
        }
        Insert: {
          action: string
          case_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: number
          tenant_id: string
          user_id: string
        }
        Update: {
          action?: string
          case_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: number
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      case_events: {
        Row: {
          case_id: string
          confidentiality: Database["public"]["Enums"]["confidentiality"]
          created_at: string
          event_date: string | null
          id: string
          label: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_document_id: string | null
          source_page: number | null
          status: Database["public"]["Enums"]["review_status"]
          tenant_id: string
        }
        Insert: {
          case_id: string
          confidentiality?: Database["public"]["Enums"]["confidentiality"]
          created_at?: string
          event_date?: string | null
          id?: string
          label: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_document_id?: string | null
          source_page?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          tenant_id: string
        }
        Update: {
          case_id?: string
          confidentiality?: Database["public"]["Enums"]["confidentiality"]
          created_at?: string
          event_date?: string | null
          id?: string
          label?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_document_id?: string | null
          source_page?: number | null
          status?: Database["public"]["Enums"]["review_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_events_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          closed_at: string | null
          company_id: string
          created_at: string
          id: string
          opened_at: string
          origin: Database["public"]["Enums"]["stoppage_origin"] | null
          reference: string | null
          status: Database["public"]["Enums"]["case_status"]
          tenant_id: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          closed_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          opened_at?: string
          origin?: Database["public"]["Enums"]["stoppage_origin"] | null
          reference?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          tenant_id: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          closed_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          opened_at?: string
          origin?: Database["public"]["Enums"]["stoppage_origin"] | null
          reference?: string | null
          status?: Database["public"]["Enums"]["case_status"]
          tenant_id?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
          siret: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          siret?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          siret?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coordination_tasks: {
        Row: {
          case_id: string
          channel: string
          created_at: string
          due_at: string | null
          escalated_reason: string | null
          id: string
          message: string
          purpose: string
          recipient: string
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          case_id: string
          channel?: string
          created_at?: string
          due_at?: string | null
          escalated_reason?: string | null
          id?: string
          message: string
          purpose: string
          recipient: string
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          case_id?: string
          channel?: string
          created_at?: string
          due_at?: string | null
          escalated_reason?: string | null
          id?: string
          message?: string
          purpose?: string
          recipient?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coordination_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordination_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          analysis_status: string
          case_id: string
          confidentiality: Database["public"]["Enums"]["confidentiality"]
          created_at: string
          doc_type: string
          extracted_text: string | null
          filename: string
          id: string
          mime_type: string | null
          page_count: number | null
          source: string
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          analysis_status?: string
          case_id: string
          confidentiality?: Database["public"]["Enums"]["confidentiality"]
          created_at?: string
          doc_type?: string
          extracted_text?: string | null
          filename: string
          id?: string
          mime_type?: string | null
          page_count?: number | null
          source?: string
          storage_path: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          analysis_status?: string
          case_id?: string
          confidentiality?: Database["public"]["Enums"]["confidentiality"]
          created_at?: string
          doc_type?: string
          extracted_text?: string | null
          filename?: string
          id?: string
          mime_type?: string | null
          page_count?: number | null
          source?: string
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_invitations: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          full_name: string | null
          id: string
          invited_by: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at: string
          full_name?: string | null
          id?: string
          invited_by: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invited_by?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_profiles: {
        Row: {
          created_at: string
          id: string
          mapping: Json
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          mapping?: Json
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          mapping?: Json
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_row_errors: {
        Row: {
          created_at: string
          errors: Json
          id: string
          import_run_id: string
          raw: Json
          row_number: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          errors?: Json
          id?: string
          import_run_id: string
          raw?: Json
          row_number: number
          tenant_id: string
        }
        Update: {
          created_at?: string
          errors?: Json
          id?: string
          import_run_id?: string
          raw?: Json
          row_number?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_row_errors_import_run_id_fkey"
            columns: ["import_run_id"]
            isOneToOne: false
            referencedRelation: "import_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_row_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_runs: {
        Row: {
          cases_created: number
          created_at: string
          file_hash: string | null
          filename: string
          id: string
          import_profile_id: string | null
          rows_failed: number
          rows_imported: number
          rows_skipped: number
          rows_total: number
          source: string
          status: string
          tenant_id: string
          workers_created: number
        }
        Insert: {
          cases_created?: number
          created_at?: string
          file_hash?: string | null
          filename: string
          id?: string
          import_profile_id?: string | null
          rows_failed?: number
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          source?: string
          status?: string
          tenant_id: string
          workers_created?: number
        }
        Update: {
          cases_created?: number
          created_at?: string
          file_hash?: string | null
          filename?: string
          id?: string
          import_profile_id?: string | null
          rows_failed?: number
          rows_imported?: number
          rows_skipped?: number
          rows_total?: number
          source?: string
          status?: string
          tenant_id?: string
          workers_created?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_runs_import_profile_id_fkey"
            columns: ["import_profile_id"]
            isOneToOne: false
            referencedRelation: "import_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_id: string | null
          created_at: string
          full_name: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          full_name?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      simulated_messages: {
        Row: {
          body: string
          case_id: string | null
          channel: string
          created_at: string
          id: string
          recipient_label: string
          sent_by: string | null
          subject: string | null
          tenant_id: string
          to_address: string | null
        }
        Insert: {
          body: string
          case_id?: string | null
          channel: string
          created_at?: string
          id?: string
          recipient_label: string
          sent_by?: string | null
          subject?: string | null
          tenant_id: string
          to_address?: string | null
        }
        Update: {
          body?: string
          case_id?: string | null
          channel?: string
          created_at?: string
          id?: string
          recipient_label?: string
          sent_by?: string | null
          subject?: string | null
          tenant_id?: string
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "simulated_messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "simulated_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      work_stoppages: {
        Row: {
          case_id: string | null
          created_at: string
          end_date: string | null
          id: string
          import_run_id: string | null
          kind: Database["public"]["Enums"]["stoppage_kind"]
          origin: Database["public"]["Enums"]["stoppage_origin"]
          row_hash: string
          start_date: string
          tenant_id: string
          worker_id: string
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          import_run_id?: string | null
          kind?: Database["public"]["Enums"]["stoppage_kind"]
          origin?: Database["public"]["Enums"]["stoppage_origin"]
          row_hash: string
          start_date: string
          tenant_id: string
          worker_id: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          end_date?: string | null
          id?: string
          import_run_id?: string | null
          kind?: Database["public"]["Enums"]["stoppage_kind"]
          origin?: Database["public"]["Enums"]["stoppage_origin"]
          row_hash?: string
          start_date?: string
          tenant_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_stoppages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_stoppages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_stoppages_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_links: {
        Row: {
          case_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          tenant_id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          tenant_id: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          tenant_id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_sessions: {
        Row: {
          case_id: string
          created_at: string
          expires_at: string
          id: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          case_id: string
          created_at?: string
          expires_at: string
          id?: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          case_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_sessions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          birth_date: string | null
          company_id: string
          created_at: string
          email: string | null
          first_name: string
          id: string
          job_title: string | null
          last_name: string
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          company_id: string
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          job_title?: string | null
          last_name: string
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          company_id?: string
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          job_title?: string | null
          last_name?: string
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      app_role:
        | "MEDECIN_TRAVAIL"
        | "IDEST"
        | "PDP_COORDINATOR"
        | "SPSTI_ADMIN"
        | "EMPLOYER_HR"
        | "WORKER"
        | "EXPERT"
      case_status: "OPEN" | "CLOSED"
      confidentiality:
        | "MEDICAL"
        | "PDP_SHARED"
        | "ADMINISTRATIVE"
        | "EMPLOYER_VISIBLE"
        | "WORKER_VISIBLE"
      review_status: "DRAFT" | "APPROVED" | "REJECTED"
      stoppage_kind: "INITIAL" | "PROLONGATION"
      stoppage_origin: "MALADIE" | "AT" | "MP"
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
        "MEDECIN_TRAVAIL",
        "IDEST",
        "PDP_COORDINATOR",
        "SPSTI_ADMIN",
        "EMPLOYER_HR",
        "WORKER",
        "EXPERT",
      ],
      case_status: ["OPEN", "CLOSED"],
      confidentiality: [
        "MEDICAL",
        "PDP_SHARED",
        "ADMINISTRATIVE",
        "EMPLOYER_VISIBLE",
        "WORKER_VISIBLE",
      ],
      review_status: ["DRAFT", "APPROVED", "REJECTED"],
      stoppage_kind: ["INITIAL", "PROLONGATION"],
      stoppage_origin: ["MALADIE", "AT", "MP"],
    },
  },
} as const
