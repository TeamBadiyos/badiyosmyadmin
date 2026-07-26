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
      area_partner_leads: {
        Row: {
          area: string
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string
          status: string
        }
        Insert: {
          area: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone: string
          status?: string
        }
        Update: {
          area?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string
          status?: string
        }
        Relationships: []
      }
      area_partners: {
        Row: {
          commission_rate: number
          created_at: string
          id: string
          name: string
          phone: string
          setup_fee_status: string
          status: string
          zone_id: string | null
        }
        Insert: {
          commission_rate?: number
          created_at?: string
          id?: string
          name: string
          phone: string
          setup_fee_status?: string
          status?: string
          zone_id?: string | null
        }
        Update: {
          commission_rate?: number
          created_at?: string
          id?: string
          name?: string
          phone?: string
          setup_fee_status?: string
          status?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "area_partners_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string
          after_state: Json | null
          before_state: Json | null
          created_at: string
          id: string
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_id: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_id?: string
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_table?: string
        }
        Relationships: []
      }
      booking_extensions: {
        Row: {
          booking_id: string
          created_at: string
          extra_minutes: number
          id: string
          price: number
          razorpay_payment_id: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string
          extra_minutes: number
          id?: string
          price: number
          razorpay_payment_id?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string
          extra_minutes?: number
          id?: string
          price?: number
          razorpay_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_extensions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          address_id: string | null
          assigned_expert_id: string | null
          booking_lat: number | null
          booking_lng: number | null
          cancellation_reason: string | null
          created_at: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          end_otp: string | null
          id: string
          price: number
          rating: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          review_text: string | null
          scheduled_date: string | null
          scheduled_time_slot: string | null
          service_duration_minutes: number
          service_end_at: string | null
          service_label: string
          slot_type: string
          start_otp: string | null
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string | null
          zone_id: string | null
        }
        Insert: {
          address_id?: string | null
          assigned_expert_id?: string | null
          booking_lat?: number | null
          booking_lng?: number | null
          cancellation_reason?: string | null
          created_at?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          end_otp?: string | null
          id?: string
          price: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_time_slot?: string | null
          service_duration_minutes: number
          service_end_at?: string | null
          service_label: string
          slot_type: string
          start_otp?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
          zone_id?: string | null
        }
        Update: {
          address_id?: string | null
          assigned_expert_id?: string | null
          booking_lat?: number | null
          booking_lng?: number | null
          cancellation_reason?: string | null
          created_at?: string | null
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          end_otp?: string | null
          id?: string
          price?: number
          rating?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          review_text?: string | null
          scheduled_date?: string | null
          scheduled_time_slot?: string | null
          service_duration_minutes?: number
          service_end_at?: string | null
          service_label?: string
          slot_type?: string
          start_otp?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string | null
          zone_id?: string | null
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
            foreignKeyName: "bookings_assigned_expert_id_fkey"
            columns: ["assigned_expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          created_at: string
          fcm_token: string
          id: string
          last_used_at: string
          platform: string
          updated_at: string
          user_id: string
          user_type: string
        }
        Insert: {
          created_at?: string
          fcm_token: string
          id?: string
          last_used_at?: string
          platform: string
          updated_at?: string
          user_id: string
          user_type: string
        }
        Update: {
          created_at?: string
          fcm_token?: string
          id?: string
          last_used_at?: string
          platform?: string
          updated_at?: string
          user_id?: string
          user_type?: string
        }
        Relationships: []
      }
      dispatch_config: {
        Row: {
          broadcast_radius_km: number
          broadcast_timeout_seconds: number
          city: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          broadcast_radius_km?: number
          broadcast_timeout_seconds?: number
          city?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          broadcast_radius_km?: number
          broadcast_timeout_seconds?: number
          city?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      edge_runtime_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      emergency_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          booking_id: string | null
          created_at: string
          expert_id: string
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          booking_id?: string | null
          created_at?: string
          expert_id: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          booking_id?: string | null
          created_at?: string
          expert_id?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_alerts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_alerts_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_leads: {
        Row: {
          area: string
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string
          status: string
        }
        Insert: {
          area: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone: string
          status?: string
        }
        Update: {
          area?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string
          status?: string
        }
        Relationships: []
      }
      expert_push_tokens: {
        Row: {
          created_at: string
          expert_id: string
          fcm_token: string
          id: string
          platform: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          expert_id: string
          fcm_token: string
          id?: string
          platform?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          expert_id?: string
          fcm_token?: string
          id?: string
          platform?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_push_tokens_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      experts: {
        Row: {
          address: string | null
          auth_user_id: string | null
          bank_account_holder_name: string | null
          bank_account_number: string | null
          bank_ifsc: string | null
          created_at: string
          current_lat: number | null
          current_lng: number | null
          id: string
          is_busy: boolean
          is_online: boolean
          kyc_aadhaar_url: string | null
          kyc_address_proof_url: string | null
          kyc_pan_url: string | null
          kyc_rejection_reason: string | null
          kyc_status: string
          level: string
          location_updated_at: string | null
          name: string
          phone: string
          photo_url: string | null
          security_deposit_status: string
          status: string
          wallet_balance: number
          zone_id: string | null
        }
        Insert: {
          address?: string | null
          auth_user_id?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_busy?: boolean
          is_online?: boolean
          kyc_aadhaar_url?: string | null
          kyc_address_proof_url?: string | null
          kyc_pan_url?: string | null
          kyc_rejection_reason?: string | null
          kyc_status?: string
          level?: string
          location_updated_at?: string | null
          name: string
          phone: string
          photo_url?: string | null
          security_deposit_status?: string
          status?: string
          wallet_balance?: number
          zone_id?: string | null
        }
        Update: {
          address?: string | null
          auth_user_id?: string | null
          bank_account_holder_name?: string | null
          bank_account_number?: string | null
          bank_ifsc?: string | null
          created_at?: string
          current_lat?: number | null
          current_lng?: number | null
          id?: string
          is_busy?: boolean
          is_online?: boolean
          kyc_aadhaar_url?: string | null
          kyc_address_proof_url?: string | null
          kyc_pan_url?: string | null
          kyc_rejection_reason?: string | null
          kyc_status?: string
          level?: string
          location_updated_at?: string | null
          name?: string
          phone?: string
          photo_url?: string | null
          security_deposit_status?: string
          status?: string
          wallet_balance?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
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
      payout_batch_items: {
        Row: {
          amount: number
          batch_id: string
          booking_ids: string[]
          created_at: string
          id: string
          owner_id: string
          owner_type: string
          paid: boolean
          paid_at: string | null
        }
        Insert: {
          amount?: number
          batch_id: string
          booking_ids?: string[]
          created_at?: string
          id?: string
          owner_id: string
          owner_type: string
          paid?: boolean
          paid_at?: string | null
        }
        Update: {
          amount?: number
          batch_id?: string
          booking_ids?: string[]
          created_at?: string
          id?: string
          owner_id?: string
          owner_type?: string
          paid?: boolean
          paid_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payout_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          created_at: string
          id: string
          paid_at: string | null
          status: string
          total_amount: number
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          paid_at?: string | null
          status?: string
          total_amount?: number
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          paid_at?: string | null
          status?: string
          total_amount?: number
          week_end?: string
          week_start?: string
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
          reversal_reason: string | null
          reversed_at: string | null
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
          reversal_reason?: string | null
          reversed_at?: string | null
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
          reversal_reason?: string | null
          reversed_at?: string | null
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
      staff_users: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          id: string
          name: string
          role: string
          status: string
          zone_id: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          id?: string
          name: string
          role: string
          status?: string
          zone_id?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          role?: string
          status?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      support_inquiries: {
        Row: {
          contact: string
          created_at: string
          id: string
          message: string
          name: string
          status: string
        }
        Insert: {
          contact: string
          created_at?: string
          id?: string
          message: string
          name: string
          status?: string
        }
        Update: {
          contact?: string
          created_at?: string
          id?: string
          message?: string
          name?: string
          status?: string
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
      wallet_ledger: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          owner_id: string
          owner_type: string
          reason: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          owner_id: string
          owner_type: string
          reason: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          owner_id?: string
          owner_type?: string
          reason?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
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
      zones: {
        Row: {
          assigned_area_partner_id: string | null
          boundary: Json
          city: string
          created_at: string
          id: string
          name: string
          status: string
        }
        Insert: {
          assigned_area_partner_id?: string | null
          boundary: Json
          city: string
          created_at?: string
          id?: string
          name: string
          status?: string
        }
        Update: {
          assigned_area_partner_id?: string | null
          boundary?: Json
          city?: string
          created_at?: string
          id?: string
          name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_assigned_area_partner_fk"
            columns: ["assigned_area_partner_id"]
            isOneToOne: false
            referencedRelation: "area_partners"
            referencedColumns: ["id"]
          },
        ]
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
      claim_booking_as_expert: {
        Args: { p_booking_id: string }
        Returns: {
          address_id: string | null
          assigned_expert_id: string | null
          booking_lat: number | null
          booking_lng: number | null
          cancellation_reason: string | null
          created_at: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          end_otp: string | null
          id: string
          price: number
          rating: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          review_text: string | null
          scheduled_date: string | null
          scheduled_time_slot: string | null
          service_duration_minutes: number
          service_end_at: string | null
          service_label: string
          slot_type: string
          start_otp: string | null
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string | null
          zone_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      credit_referral_for_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      ensure_start_otp: { Args: { _booking_id: string }; Returns: string }
      expert_ensure_booking_codes: {
        Args: { _booking_id: string }
        Returns: {
          end_otp: string
          start_otp: string
        }[]
      }
      expert_reject_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      expert_set_online: { Args: { _online: boolean }; Returns: undefined }
      expert_update_location: {
        Args: { p_lat: number; p_lng: number }
        Returns: undefined
      }
      expert_update_photo_url: { Args: { _url: string }; Returns: undefined }
      expert_verify_end_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: number
      }
      expert_verify_start_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: string
      }
      extend_booking: {
        Args: {
          _booking_id: string
          _extra_minutes: number
          _razorpay_payment_id: string
        }
        Returns: string
      }
      generate_otp4: { Args: never; Returns: string }
      get_assigned_expert_public: {
        Args: { _booking_id: string }
        Returns: {
          id: string
          level: string
          name: string
          phone: string
          photo_url: string
          status: string
          zone_id: string
        }[]
      }
      get_auth_user_id_by_email: { Args: { _email: string }; Returns: string }
      get_auth_user_id_by_phone: { Args: { _phone: string }; Returns: string }
      get_eligible_experts_for_booking: {
        Args: { p_booking_id: string }
        Returns: {
          distance_km: number
          expert_id: string
        }[]
      }
      get_expert_id_for_auth: { Args: { _auth_uid: string }; Returns: string }
      haversine_km: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      is_active_staff: {
        Args: { _roles: string[]; _uid: string }
        Returns: boolean
      }
      link_referral: { Args: { _code: string }; Returns: undefined }
      point_in_polygon: {
        Args: { _lat: number; _lng: number; _poly: Json }
        Returns: boolean
      }
      register_device_token: {
        Args: { p_fcm_token: string; p_platform: string }
        Returns: string
      }
      resolve_caller_identity: {
        Args: { _auth_uid: string }
        Returns: {
          user_id: string
          user_type: string
        }[]
      }
      resolve_zone_for_point: {
        Args: { _lat: number; _lng: number }
        Returns: string
      }
      staff_accept_booking: {
        Args: { _booking_id: string }
        Returns: undefined
      }
      staff_assign_area_partner: {
        Args: { _partner_id: string; _zone_id: string }
        Returns: undefined
      }
      staff_assign_expert: {
        Args: { _booking_id: string; _expert_id: string }
        Returns: undefined
      }
      staff_cancel_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      staff_edit_booking: {
        Args: { _booking_id: string; _payload: Json }
        Returns: undefined
      }
      staff_expert_kyc_decision: {
        Args: { _decision: string; _expert_id: string; _reason: string }
        Returns: undefined
      }
      staff_generate_payout_batch: { Args: never; Returns: string }
      staff_mark_payout_batch_paid: {
        Args: { _batch_id: string }
        Returns: undefined
      }
      staff_mark_payout_item_paid: {
        Args: { _item_id: string; _paid: boolean }
        Returns: undefined
      }
      staff_reassign_expert: {
        Args: { _booking_id: string; _new_expert_id: string }
        Returns: undefined
      }
      staff_reject_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      staff_reorder_homepage_sections: {
        Args: { _orders: Json }
        Returns: undefined
      }
      staff_reverse_referral_reward: {
        Args: { _reason: string; _txn_id: string }
        Returns: undefined
      }
      staff_set_homepage_section_active: {
        Args: { _active: boolean; _id: string }
        Returns: undefined
      }
      staff_soft_delete_booking: {
        Args: { _booking_id: string; _reason: string }
        Returns: undefined
      }
      staff_update_booking_status: {
        Args: { _booking_id: string; _new_status: string; _note?: string }
        Returns: undefined
      }
      staff_update_referral_config: {
        Args: { _is_active: boolean; _reward: number }
        Returns: undefined
      }
      staff_update_service_price: {
        Args: { _id: string; _payload: Json }
        Returns: undefined
      }
      staff_upsert_area_partner: { Args: { _payload: Json }; Returns: string }
      staff_upsert_expert: { Args: { _payload: Json }; Returns: string }
      staff_upsert_homepage_section: {
        Args: { _payload: Json }
        Returns: string
      }
      staff_verify_end_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: undefined
      }
      staff_verify_start_otp: {
        Args: { _booking_id: string; _otp: string }
        Returns: undefined
      }
      staff_wallet_adjust: {
        Args: {
          _amount: number
          _owner_id: string
          _owner_type: string
          _reason: string
          _type: string
        }
        Returns: string
      }
      start_service: { Args: { _booking_id: string }; Returns: string }
      submit_booking_review: {
        Args: { _booking_id: string; _rating: number; _review: string }
        Returns: undefined
      }
      system_accept_booking_after_payment: {
        Args: { _booking_id: string }
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
