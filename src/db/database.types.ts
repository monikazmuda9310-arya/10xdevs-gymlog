export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      exercise_entries: {
        Row: {
          created_at: string;
          exercise_id: string;
          id: string;
          updated_at: string;
          user_id: string;
          workout_id: string;
        };
        Insert: {
          created_at?: string;
          exercise_id: string;
          id?: string;
          updated_at?: string;
          user_id: string;
          workout_id: string;
        };
        Update: {
          created_at?: string;
          exercise_id?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
          workout_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exercise_entries_exercise_id_fkey";
            columns: ["exercise_id"];
            isOneToOne: false;
            referencedRelation: "exercises";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exercise_entries_workout_owner_fkey";
            columns: ["workout_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "workouts";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      exercises: {
        Row: {
          created_at: string;
          id: string;
          is_bodyweight: boolean;
          muscle_group: Database["public"]["Enums"]["muscle_group"];
          name: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_bodyweight?: boolean;
          muscle_group: Database["public"]["Enums"]["muscle_group"];
          name: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_bodyweight?: boolean;
          muscle_group?: Database["public"]["Enums"]["muscle_group"];
          name?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          estimation_formula: Database["public"]["Enums"]["estimation_formula"];
          id: string;
          timezone: string;
          updated_at: string;
          weight_unit: Database["public"]["Enums"]["weight_unit"];
        };
        Insert: {
          created_at?: string;
          estimation_formula?: Database["public"]["Enums"]["estimation_formula"];
          id: string;
          timezone?: string;
          updated_at?: string;
          weight_unit?: Database["public"]["Enums"]["weight_unit"];
        };
        Update: {
          created_at?: string;
          estimation_formula?: Database["public"]["Enums"]["estimation_formula"];
          id?: string;
          timezone?: string;
          updated_at?: string;
          weight_unit?: Database["public"]["Enums"]["weight_unit"];
        };
        Relationships: [];
      };
      sets: {
        Row: {
          created_at: string;
          exercise_entry_id: string;
          id: string;
          reps: number;
          rpe: number | null;
          updated_at: string;
          user_id: string;
          weight: number;
          weight_kg: number | null;
          weight_unit: Database["public"]["Enums"]["weight_unit"];
        };
        Insert: {
          created_at?: string;
          exercise_entry_id: string;
          id?: string;
          reps: number;
          rpe?: number | null;
          updated_at?: string;
          user_id: string;
          weight: number;
          weight_kg?: number | null;
          weight_unit: Database["public"]["Enums"]["weight_unit"];
        };
        Update: {
          created_at?: string;
          exercise_entry_id?: string;
          id?: string;
          reps?: number;
          rpe?: number | null;
          updated_at?: string;
          user_id?: string;
          weight?: number;
          weight_kg?: number | null;
          weight_unit?: Database["public"]["Enums"]["weight_unit"];
        };
        Relationships: [
          {
            foreignKeyName: "sets_entry_owner_fkey";
            columns: ["exercise_entry_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "exercise_entries";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      workouts: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          performed_on: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          performed_on: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          performed_on?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      daily_exercise_tonnage: {
        Row: {
          exercise_id: string | null;
          exercise_name: string | null;
          muscle_group: Database["public"]["Enums"]["muscle_group"] | null;
          performed_on: string | null;
          tonnage_kg: number | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "exercise_entries_exercise_id_fkey";
            columns: ["exercise_id"];
            isOneToOne: false;
            referencedRelation: "exercises";
            referencedColumns: ["id"];
          },
        ];
      };
      daily_tonnage: {
        Row: {
          performed_on: string | null;
          tonnage_kg: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
      personal_records: {
        Row: {
          best_estimate_kg: number | null;
          best_estimate_performed_on: string | null;
          best_estimate_reps: number | null;
          best_estimate_set_id: string | null;
          best_estimate_weight: number | null;
          best_estimate_weight_kg: number | null;
          best_estimate_weight_unit: Database["public"]["Enums"]["weight_unit"] | null;
          best_estimate_workout_id: string | null;
          exercise_id: string | null;
          exercise_name: string | null;
          heaviest_performed_on: string | null;
          heaviest_reps: number | null;
          heaviest_set_id: string | null;
          heaviest_weight: number | null;
          heaviest_weight_kg: number | null;
          heaviest_weight_unit: Database["public"]["Enums"]["weight_unit"] | null;
          heaviest_workout_id: string | null;
          is_bodyweight: boolean | null;
          last_record_on: string | null;
          muscle_group: Database["public"]["Enums"]["muscle_group"] | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "exercise_entries_exercise_id_fkey";
            columns: ["exercise_id"];
            isOneToOne: false;
            referencedRelation: "exercises";
            referencedColumns: ["id"];
          },
        ];
      };
      set_estimates: {
        Row: {
          created_at: string | null;
          estimate_kg: number | null;
          exercise_entry_id: string | null;
          exercise_id: string | null;
          performed_on: string | null;
          reps: number | null;
          set_id: string | null;
          user_id: string | null;
          weight: number | null;
          weight_kg: number | null;
          weight_unit: Database["public"]["Enums"]["weight_unit"] | null;
          workout_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "exercise_entries_exercise_id_fkey";
            columns: ["exercise_id"];
            isOneToOne: false;
            referencedRelation: "exercises";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sets_entry_owner_fkey";
            columns: ["exercise_entry_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "exercise_entries";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      estimation_formula: "epley" | "brzycki";
      muscle_group: "legs" | "back" | "chest" | "shoulders" | "arms" | "core";
      weight_unit: "kg" | "lb";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      estimation_formula: ["epley", "brzycki"],
      muscle_group: ["legs", "back", "chest", "shoulders", "arms", "core"],
      weight_unit: ["kg", "lb"],
    },
  },
} as const;
