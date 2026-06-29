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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          body: string | null
          created_at: string
          description: string | null
          external_url: string | null
          id: string
          lecture_id: string | null
          order: number
          section_id: string | null
          storage_path: string | null
          title: string
          type: Database["public"]["Enums"]["attachment_type"]
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          description?: string | null
          external_url?: string | null
          id?: string
          lecture_id?: string | null
          order?: number
          section_id?: string | null
          storage_path?: string | null
          title: string
          type: Database["public"]["Enums"]["attachment_type"]
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          description?: string | null
          external_url?: string | null
          id?: string
          lecture_id?: string | null
          order?: number
          section_id?: string | null
          storage_path?: string | null
          title?: string
          type?: Database["public"]["Enums"]["attachment_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_listening: {
        Row: {
          created_at: string
          day: string
          lecture_ids: string[]
          seconds_listened: number
          user_id: string
        }
        Insert: {
          created_at?: string
          day: string
          lecture_ids?: string[]
          seconds_listened?: number
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          lecture_ids?: string[]
          seconds_listened?: number
          user_id?: string
        }
        Relationships: []
      }
      lectures: {
        Row: {
          audio_path: string | null
          created_at: string
          duration_sec: number | null
          id: string
          order: number
          section_id: string | null
          sheikh_id: string | null
          status: Database["public"]["Enums"]["lecture_status"]
          title: string
          updated_at: string
        }
        Insert: {
          audio_path?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          order?: number
          section_id?: string | null
          sheikh_id?: string | null
          status?: Database["public"]["Enums"]["lecture_status"]
          title: string
          updated_at?: string
        }
        Update: {
          audio_path?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          order?: number
          section_id?: string | null
          sheikh_id?: string | null
          status?: Database["public"]["Enums"]["lecture_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lectures_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lectures_sheikh_id_fkey"
            columns: ["sheikh_id"]
            isOneToOne: false
            referencedRelation: "sheikhs"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          enabled: boolean
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          enabled?: boolean
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          enabled?: boolean
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json
          id: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      section_follows: {
        Row: {
          created_at: string
          section_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          section_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          section_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "section_follows_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          cover_image: string | null
          cover_letter: string
          created_at: string
          description: string | null
          id: string
          order: number
          parent_id: string | null
          show_header: boolean
          title: string
          updated_at: string
        }
        Insert: {
          cover_image?: string | null
          cover_letter?: string
          created_at?: string
          description?: string | null
          id?: string
          order?: number
          parent_id?: string | null
          show_header?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          cover_image?: string | null
          cover_letter?: string
          created_at?: string
          description?: string | null
          id?: string
          order?: number
          parent_id?: string | null
          show_header?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sections_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sheikhs: {
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
      user_badges: {
        Row: {
          badge_key: string
          earned_at: string
          user_id: string
        }
        Insert: {
          badge_key: string
          earned_at?: string
          user_id: string
        }
        Update: {
          badge_key?: string
          earned_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_lecture_progress: {
        Row: {
          completed: boolean
          lecture_id: string
          position_sec: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          lecture_id: string
          position_sec?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          lecture_id?: string
          position_sec?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_lecture_progress_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_goals: {
        Row: {
          metric: Database["public"]["Enums"]["goal_metric"]
          target: number
          updated_at: string
          user_id: string
        }
        Insert: {
          metric?: Database["public"]["Enums"]["goal_metric"]
          target?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          metric?: Database["public"]["Enums"]["goal_metric"]
          target?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_children_rollups: {
        Args: { p_section_ids: string[] }
        Returns: {
          completed_lectures: number
          section_id: string
          total_lectures: number
        }[]
      }
      get_current_streak: { Args: never; Returns: number }
      get_journey_summary: {
        Args: never
        Returns: {
          active_days: number
          completed_lectures: number
          current_streak: number
          longest_streak: number
          total_seconds: number
          week_current: number
          week_metric: Database["public"]["Enums"]["goal_metric"]
          week_target: number
        }[]
      }
      get_section_rollup: {
        Args: { p_section_id: string }
        Returns: {
          completed_lectures: number
          sheikh_names: string[]
          total_lectures: number
        }[]
      }
      get_sections_flat: {
        Args: never
        Returns: {
          depth: number
          id: string
          parent_id: string
          path: string[]
          title: string
        }[]
      }
      get_week_progress: {
        Args: never
        Returns: {
          current: number
          metric: Database["public"]["Enums"]["goal_metric"]
          target: number
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      record_daily_listening: {
        Args: { p_lecture_id: string; p_seconds: number }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "student" | "admin"
      attachment_type: "pdf" | "book" | "transcript" | "image" | "link"
      goal_metric: "lectures" | "minutes"
      lecture_status: "draft" | "published"
      notification_type:
        | "new_lecture"
        | "new_attachment"
        | "new_quiz"
        | "resume_reminder"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["student", "admin"],
      attachment_type: ["pdf", "book", "transcript", "image", "link"],
      goal_metric: ["lectures", "minutes"],
      lecture_status: ["draft", "published"],
      notification_type: [
        "new_lecture",
        "new_attachment",
        "new_quiz",
        "resume_reminder",
      ],
    },
  },
} as const
