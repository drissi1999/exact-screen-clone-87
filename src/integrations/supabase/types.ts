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
          created_at: string
          full_name: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
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
      current_tenant_id: { Args: never; Returns: string }
    }
    Enums: {
      app_role:
        | "MEDECIN_TRAVAIL"
        | "IDEST"
        | "PDP_COORDINATOR"
        | "SPSTI_ADMIN"
        | "EMPLOYER_HR"
        | "WORKER"
      case_status: "OPEN" | "CLOSED"
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
      ],
      case_status: ["OPEN", "CLOSED"],
      stoppage_kind: ["INITIAL", "PROLONGATION"],
      stoppage_origin: ["MALADIE", "AT", "MP"],
    },
  },
} as const
