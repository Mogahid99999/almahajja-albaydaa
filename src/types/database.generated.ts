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
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
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
      broadcasts: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          published_at: string | null
          show_on_home: boolean
          title: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          published_at?: string | null
          show_on_home?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          published_at?: string | null
          show_on_home?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      buddy_requests: {
        Row: {
          created_at: string
          from_user_id: string
          id: string
          responded_at: string | null
          status: string
          to_user_id: string
        }
        Insert: {
          created_at?: string
          from_user_id: string
          id?: string
          responded_at?: string | null
          status?: string
          to_user_id: string
        }
        Update: {
          created_at?: string
          from_user_id?: string
          id?: string
          responded_at?: string | null
          status?: string
          to_user_id?: string
        }
        Relationships: []
      }
      daily_listening: {
        Row: {
          created_at: string
          day: string
          lecture_ids: string[]
          meaningful: boolean
          seconds_listened: number
          user_id: string
        }
        Insert: {
          created_at?: string
          day: string
          lecture_ids?: string[]
          meaningful?: boolean
          seconds_listened?: number
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          lecture_ids?: string[]
          meaningful?: boolean
          seconds_listened?: number
          user_id?: string
        }
        Relationships: []
      }
      featured_lectures: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          lecture_id: string
          order: number
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          lecture_id: string
          order?: number
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          lecture_id?: string
          order?: number
        }
        Relationships: [
          {
            foreignKeyName: "featured_lectures_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: true
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_benefits: {
        Row: {
          body: string
          created_at: string
          id: string
          lecture_id: string
          status: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          lecture_id: string
          status?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          lecture_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_benefits_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_notes: {
        Row: {
          body: string
          lecture_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          lecture_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          lecture_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_notes_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
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
          gender: string | null
          id: string
          last_opened_at: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          gender?: string | null
          id: string
          last_opened_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          display_name?: string | null
          gender?: string | null
          id?: string
          last_opened_at?: string | null
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
      questions: {
        Row: {
          answer_body: string | null
          answered_at: string | null
          answered_by: string | null
          asker_id: string
          audience: string
          body: string
          created_at: string
          id: string
          is_anonymous: boolean
          lecture_id: string | null
          scope: string
          status: string
        }
        Insert: {
          answer_body?: string | null
          answered_at?: string | null
          answered_by?: string | null
          asker_id: string
          audience?: string
          body: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          lecture_id?: string | null
          scope: string
          status?: string
        }
        Update: {
          answer_body?: string | null
          answered_at?: string | null
          answered_by?: string | null
          asker_id?: string
          audience?: string
          body?: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          lecture_id?: string | null
          scope?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_lecture_id_fkey"
            columns: ["lecture_id"]
            isOneToOne: false
            referencedRelation: "lectures"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempt_answers: {
        Row: {
          attempt_id: string
          option_id: string
          question_id: string
        }
        Insert: {
          attempt_id: string
          option_id: string
          question_id: string
        }
        Update: {
          attempt_id?: string
          option_id?: string
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempt_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "quiz_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempt_answers_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "quiz_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_attempt_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          attempt_no: number
          id: string
          passed: boolean | null
          quiz_id: string
          score: number | null
          started_at: string
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          attempt_no?: number
          id?: string
          passed?: boolean | null
          quiz_id: string
          score?: number | null
          started_at?: string
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          attempt_no?: number
          id?: string
          passed?: boolean | null
          quiz_id?: string
          score?: number | null
          started_at?: string
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_options: {
        Row: {
          id: string
          is_correct: boolean
          order: number
          question_id: string
          text: string
        }
        Insert: {
          id?: string
          is_correct?: boolean
          order?: number
          question_id: string
          text: string
        }
        Update: {
          id?: string
          is_correct?: boolean
          order?: number
          question_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "quiz_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_questions: {
        Row: {
          id: string
          order: number
          points: number
          quiz_id: string
          text: string
        }
        Insert: {
          id?: string
          order?: number
          points?: number
          quiz_id: string
          text: string
        }
        Update: {
          id?: string
          order?: number
          points?: number
          quiz_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_questions_quiz_id_fkey"
            columns: ["quiz_id"]
            isOneToOne: false
            referencedRelation: "quizzes"
            referencedColumns: ["id"]
          },
        ]
      }
      quizzes: {
        Row: {
          created_at: string
          description: string | null
          id: string
          max_attempts: number | null
          order: number
          pass_score: number
          section_id: string
          show_correct_answers: boolean
          show_result: boolean
          status: string
          time_limit_sec: number | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          max_attempts?: number | null
          order?: number
          pass_score?: number
          section_id: string
          show_correct_answers?: boolean
          show_result?: boolean
          status?: string
          time_limit_sec?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          max_attempts?: number | null
          order?: number
          pass_score?: number
          section_id?: string
          show_correct_answers?: boolean
          show_result?: boolean
          status?: string
          time_limit_sec?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quizzes_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
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
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      streak_recovery_state: {
        Row: {
          broke_at: string | null
          recovered_at: string | null
          streak_before: number | null
          user_id: string
        }
        Insert: {
          broke_at?: string | null
          recovered_at?: string | null
          streak_before?: number | null
          user_id: string
        }
        Update: {
          broke_at?: string | null
          recovered_at?: string | null
          streak_before?: number | null
          user_id?: string
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
      weekly_goal_state: {
        Row: {
          congrats_sent_at: string | null
          midweek_sent_at: string | null
          twodays_sent_at: string | null
          user_id: string
          week_start: string
        }
        Insert: {
          congrats_sent_at?: string | null
          midweek_sent_at?: string | null
          twodays_sent_at?: string | null
          user_id: string
          week_start: string
        }
        Update: {
          congrats_sent_at?: string | null
          midweek_sent_at?: string | null
          twodays_sent_at?: string | null
          user_id?: string
          week_start?: string
        }
        Relationships: []
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
      add_featured_lecture: {
        Args: { p_lecture_id: string }
        Returns: undefined
      }
      add_lecture_benefit: {
        Args: { p_body: string; p_lecture_id: string }
        Returns: string
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_list_benefits: {
        Args: { p_lecture_id?: string }
        Returns: {
          author_email: string
          author_id: string
          author_name: string
          body: string
          created_at: string
          id: string
          lecture_id: string
          lecture_title: string
          status: string
        }[]
      }
      admin_progress_analytics: { Args: never; Returns: Json }
      admin_set_benefit_status: {
        Args: { p_id: string; p_status: string }
        Returns: undefined
      }
      admin_user_detail: { Args: { p_user_id: string }; Returns: Json }
      admin_user_list: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          banned_until: string
          completed_lectures: number
          created_at: string
          current_streak: number
          display_name: string
          email: string
          gender: string
          id: string
          last_opened_at: string
          last_sign_in_at: string
          passed_quizzes: number
          phone: string
          role: string
          status: string
          weekly_goal_metric: string
          weekly_goal_target: number
        }[]
      }
      answer_question: {
        Args: { p_answer_body: string; p_question_id: string }
        Returns: undefined
      }
      ask_question: {
        Args: {
          p_audience: string
          p_body: string
          p_is_anonymous: boolean
          p_lecture_id: string
          p_scope: string
        }
        Returns: string
      }
      buddy_of: { Args: { p_user_id: string }; Returns: string }
      cancel_buddy: { Args: never; Returns: undefined }
      create_broadcast: {
        Args: { p_body: string; p_show_on_home?: boolean; p_title: string }
        Returns: string
      }
      delete_broadcast: { Args: { p_id: string }; Returns: undefined }
      delete_own_benefit: { Args: { p_id: string }; Returns: undefined }
      delete_own_question: {
        Args: { p_question_id: string }
        Returns: undefined
      }
      delete_question: { Args: { p_question_id: string }; Returns: undefined }
      dispatch_resume_nudges: { Args: never; Returns: undefined }
      dispatch_streak_reminders: { Args: never; Returns: undefined }
      dispatch_weekly_goal_nudges: { Args: never; Returns: undefined }
      fanout_to_all: {
        Args: {
          p_body: string
          p_data: Json
          p_title: string
          p_type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: undefined
      }
      fanout_to_followers: {
        Args: {
          p_body: string
          p_data: Json
          p_section_id: string
          p_title: string
          p_type: Database["public"]["Enums"]["notification_type"]
        }
        Returns: undefined
      }
      followers_of_section: {
        Args: { p_section_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_attempt_detail: { Args: { p_attempt_id: string }; Returns: Json }
      get_attempt_questions: { Args: { p_attempt_id: string }; Returns: Json }
      get_attempt_result: { Args: { p_attempt_id: string }; Returns: Json }
      get_broadcast: {
        Args: { p_id: string }
        Returns: {
          body: string
          id: string
          published_at: string
          show_on_home: boolean
          title: string
          updated_at: string
        }[]
      }
      get_buddy_status: {
        Args: never
        Returns: {
          buddy_id: string
          current_streak: number
          display_name: string
          today_counted: boolean
          week_progress_pct: number
          weekly_goal_met: boolean
        }[]
      }
      get_children_rollups: {
        Args: { p_section_ids: string[] }
        Returns: {
          completed_lectures: number
          section_id: string
          total_lectures: number
        }[]
      }
      get_current_streak: { Args: never; Returns: number }
      get_featured_lectures: {
        Args: never
        Returns: {
          completed: boolean
          duration_sec: number
          lecture_id: string
          order: number
          position_sec: number
          section_title: string
          sheikh_name: string
          title: string
        }[]
      }
      get_featured_lectures_admin: {
        Args: never
        Returns: {
          duration_sec: number
          lecture_id: string
          order: number
          section_title: string
          sheikh_name: string
          status: string
          title: string
        }[]
      }
      get_home_broadcasts: {
        Args: never
        Returns: {
          body: string
          id: string
          published_at: string
          title: string
        }[]
      }
      get_incoming_buddy_requests: {
        Args: never
        Returns: {
          created_at: string
          from_display_name: string
          id: string
        }[]
      }
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
      get_lecture_benefits: {
        Args: { p_lecture_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          is_mine: boolean
        }[]
      }
      get_my_buddy_id: { Args: never; Returns: string }
      get_my_questions: {
        Args: { p_lecture_id?: string; p_scope: string }
        Returns: {
          answer_body: string
          answered_at: string
          audience: string
          body: string
          created_at: string
          id: string
          is_anonymous: boolean
          status: string
        }[]
      }
      get_my_quiz_stats: {
        Args: never
        Returns: {
          attempted: number
          passed: number
        }[]
      }
      get_public_questions: {
        Args: { p_lecture_id?: string; p_scope: string }
        Returns: {
          answer_body: string
          answered_at: string
          asker_display: string
          body: string
          created_at: string
          id: string
          is_mine: boolean
        }[]
      }
      get_question_inbox: {
        Args: { p_scope?: string; p_status?: string }
        Returns: {
          answer_body: string
          answered_at: string
          asker_display: string
          asker_id: string
          audience: string
          body: string
          created_at: string
          id: string
          is_anonymous: boolean
          lecture_id: string
          lecture_title: string
          scope: string
          status: string
        }[]
      }
      get_quiz_intro: {
        Args: { p_quiz_id: string }
        Returns: {
          attempts_left: number
          attempts_used: number
          best_score: number
          description: string
          id: string
          in_progress_attempt_id: string
          last_result_attempt_id: string
          max_attempts: number
          pass_score: number
          passed: boolean
          question_count: number
          section_id: string
          section_title: string
          time_limit_sec: number
          title: string
          total_score: number
        }[]
      }
      get_quiz_results_summary: {
        Args: { p_quiz_id: string }
        Returns: {
          avg_score: number
          entered: number
          failed_count: number
          incomplete_count: number
          max_score: number
          min_score: number
          not_taken: number
          passed_count: number
        }[]
      }
      get_section_quizzes: {
        Args: { p_section_id: string }
        Returns: {
          attempts_left: number
          attempts_used: number
          best_score: number
          description: string
          id: string
          in_progress_attempt_id: string
          last_result_attempt_id: string
          max_attempts: number
          pass_score: number
          passed: boolean
          question_count: number
          sort_order: number
          time_limit_sec: number
          title: string
          total_score: number
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
      get_streak_status: {
        Args: never
        Returns: {
          current_streak: number
          recovery_available: boolean
          recovery_days_left: number
          today_counted: boolean
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
      is_content_manager: { Args: never; Returns: boolean }
      is_moderator: { Args: never; Returns: boolean }
      is_sheikh: { Args: never; Returns: boolean }
      list_quiz_result_rows: {
        Args: { p_quiz_id: string }
        Returns: {
          attempts_used: number
          best_score: number
          display_name: string
          last_attempt_at: string
          last_attempt_id: string
          status: string
          user_id: string
        }[]
      }
      quiz_result_payload: { Args: { p_attempt_id: string }; Returns: Json }
      record_daily_listening: {
        Args: { p_lecture_id: string; p_seconds: number }
        Returns: undefined
      }
      record_meaningful_activity: {
        Args: { p_completed?: boolean; p_lecture_id: string; p_seconds: number }
        Returns: undefined
      }
      remove_featured_lecture: {
        Args: { p_lecture_id: string }
        Returns: undefined
      }
      reorder_featured_lectures: {
        Args: { p_lecture_ids: string[] }
        Returns: undefined
      }
      respond_buddy_request: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: undefined
      }
      save_quiz_answer: {
        Args: {
          p_attempt_id: string
          p_option_id: string
          p_question_id: string
        }
        Returns: undefined
      }
      search_buddy_candidates: {
        Args: { p_search: string }
        Returns: {
          current_streak: number
          display_name: string
          id: string
        }[]
      }
      send_buddy_request: { Args: { p_to_user_id: string }; Returns: undefined }
      set_app_config: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      set_own_profile: {
        Args: { p_display_name?: string; p_gender?: string }
        Returns: undefined
      }
      set_question_hidden: {
        Args: { p_hidden: boolean; p_question_id: string }
        Returns: undefined
      }
      start_quiz_attempt: { Args: { p_quiz_id: string }; Returns: string }
      streak_for_user: { Args: { p_user_id: string }; Returns: number }
      submit_quiz_attempt: { Args: { p_attempt_id: string }; Returns: Json }
      touch_last_opened: { Args: never; Returns: undefined }
      try_claim_goal_congrats: { Args: never; Returns: boolean }
      update_broadcast: {
        Args: {
          p_body: string
          p_id: string
          p_show_on_home: boolean
          p_title: string
        }
        Returns: undefined
      }
      week_progress_for_user: {
        Args: { p_user_id: string }
        Returns: {
          current: number
          metric: Database["public"]["Enums"]["goal_metric"]
          target: number
        }[]
      }
    }
    Enums: {
      app_role: "student" | "admin" | "publisher" | "sheikh"
      attachment_type: "pdf" | "book" | "transcript" | "image" | "link"
      goal_metric: "lectures" | "minutes"
      lecture_status: "draft" | "published"
      notification_type:
        | "new_lecture"
        | "new_attachment"
        | "new_quiz"
        | "resume_reminder"
        | "resume_series"
        | "completion_praise"
        | "daily_reminder"
        | "noncompletion_gentle"
        | "weekly_goal"
        | "buddy_activity"
        | "buddy_request"
        | "question_received"
        | "question_answered"
        | "streak_reminder"
        | "beneficial_reminder"
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
      app_role: ["student", "admin", "publisher", "sheikh"],
      attachment_type: ["pdf", "book", "transcript", "image", "link"],
      goal_metric: ["lectures", "minutes"],
      lecture_status: ["draft", "published"],
      notification_type: [
        "new_lecture",
        "new_attachment",
        "new_quiz",
        "resume_reminder",
        "resume_series",
        "completion_praise",
        "daily_reminder",
        "noncompletion_gentle",
        "weekly_goal",
        "buddy_activity",
        "buddy_request",
        "question_received",
        "question_answered",
        "streak_reminder",
        "beneficial_reminder",
      ],
    },
  },
} as const
