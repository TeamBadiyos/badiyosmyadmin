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
      addresses: {
        Row: {
          area: string | null
          city: string | null
          created_at: string | null
          full_address: string
          id: string
          is_default: boolean | null
          label: string | null
          landmark_photo_url: string | null
          latitude: number | null
          longitude: number | null
          user_id: string | null
        }
        Insert: {
          area?: string | null
          city?: string | null
          created_at?: string | null
          full_address: string
          id?: string
          is_default?: boolean | null
          label?: string | null
          landmark_photo_url?: string | null
          latitude?: number | null
          longitude?: number | null
          user_id?: string | null
        }
        Update: {
          area?: string | null
          city?: string | null
          created_at?: string | null
          full_address?: string
          id?: string
          is_default?: boolean | null
          label?: string | null
          landmark_photo_url?: string | null
          latitude?: number | null
          longitude?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          current_version: string
          id: number
          min_supported_version: string
          updated_at: string
        }
        Insert: {
          current_version?: string
          id?: number
          min_supported_version?: string
          updated_at?: string
        }
        Update: {
          current_version?: string
          id?: number
          min_supported_version?: string
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          address_id: string | null
          created_at: string | null
          id: string
          price: number
          rating: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          review_text: string | null
          scheduled_date: string | null
          scheduled_time_slot: string | null
          service_duration_minutes: number
          service_label: string
          slot_type: string
          status: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          address_id?: string | null
          created_at?: string | null
          id?: string
          price: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_time_slot?: string | null
          service_duration_minutes: number
          service_label: string
          slot_type: string
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          address_id?: string | null
          created_at?: string | null
          id?: string
          price?: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_time_slot?: string | null
          service_duration_minutes?: number
          service_label?: string
          slot_type?: string
          status?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fcm_tokens: {
        Row: {
          created_at: string
          id: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      homepage_sections: {
        Row: {
          city_id: string | null
          display_order: number
          is_active: boolean | null
          payload: Json
          section_id: string
          section_type: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          city_id?: string | null
          display_order?: number
          is_active?: boolean | null
          payload: Json
          section_id?: string
          section_type: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          city_id?: string | null
          display_order?: number
          is_active?: boolean | null
          payload?: Json
          section_id?: string
          section_type?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      otp_codes: {
        Row: {
          code: string
          created_at: string | null
          expires_at: string
          id: string
          is_verified: boolean | null
          phone: string
        }
        Insert: {
          code: string
          created_at?: string | null
          expires_at: string
          id?: string
          is_verified?: boolean | null
          phone: string
        }
        Update: {
          code?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          is_verified?: boolean | null
          phone?: string
        }
        Relationships: []
      }
      otp_rate_limits: {
        Row: {
          created_at: string
          id: string
          ip: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      referral_config: {
        Row: {
          id: string
          is_active: boolean
          milestone_referrals: number | null
          milestone_reward_coins: number | null
          reward_coins: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          is_active?: boolean
          milestone_referrals?: number | null
          milestone_reward_coins?: number | null
          reward_coins?: number
          updated_at?: string | null
        }
        Update: {
          id?: string
          is_active?: boolean
          milestone_referrals?: number | null
          milestone_reward_coins?: number | null
          reward_coins?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      referral_transactions: {
        Row: {
          booking_id: string | null
          created_at: string | null
          id: string
          referred_user_id: string | null
          referrer_id: string | null
          reward_amount: number | null
          reward_date: string | null
          status: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          referred_user_id?: string | null
          referrer_id?: string | null
          reward_amount?: number | null
          reward_date?: string | null
          status?: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string | null
          id?: string
          referred_user_id?: string | null
          referrer_id?: string | null
          reward_amount?: number | null
          reward_date?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_transactions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_transactions_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_transactions_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_catalogue_config: {
        Row: {
          area_partner_payout: number | null
          created_at: string | null
          display_order: number | null
          duration_label: string
          duration_minutes: number
          expert_payout: number | null
          hq_revenue: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          price: number
          subtitle: string | null
        }
        Insert: {
          area_partner_payout?: number | null
          created_at?: string | null
          display_order?: number | null
          duration_label: string
          duration_minutes: number
          expert_payout?: number | null
          hq_revenue?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          price: number
          subtitle?: string | null
        }
        Update: {
          area_partner_payout?: number | null
          created_at?: string | null
          display_order?: number | null
          duration_label?: string
          duration_minutes?: number
          expert_payout?: number | null
          hq_revenue?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          price?: number
          subtitle?: string | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          created_at: string
          id: string
          message: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          notification_preferences: Json
          phone: string | null
          referral_code: string | null
          referral_count: number | null
          referred_by: string | null
          successful_referrals: number | null
          total_coins_earned: number | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          notification_preferences?: Json
          phone?: string | null
          referral_code?: string | null
          referral_count?: number | null
          referred_by?: string | null
          successful_referrals?: number | null
          total_coins_earned?: number | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          notification_preferences?: Json
          phone?: string | null
          referral_code?: string | null
          referral_count?: number | null
          referred_by?: string | null
          successful_referrals?: number | null
          total_coins_earned?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          type: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          description: string
          id?: string
          type: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_booking_status: {
        Args: { _booking_id: string; _new_status: string }
        Returns: undefined
      }
      credit_referral_for_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      get_auth_user_id_by_email: { Args: { _email: string }; Returns: string }
      get_auth_user_id_by_phone: { Args: { _phone: string }; Returns: string }
      link_referral: { Args: { _code: string }; Returns: undefined }
      submit_booking_review: {
        Args: { _booking_id: string; _rating: number; _review: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
