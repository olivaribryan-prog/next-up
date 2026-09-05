import { createClient } from "@supabase/supabase-js";

// Fall back to placeholders so a build without env vars configured yet doesn't crash.
// Set the real values in your host's environment variables for the app to actually work.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: {
    params: { eventsPerSecond: 5 },
  },
});

export type Participant = {
  id: string;
  name: string;
  email: string;
  created_at: string;
};

export type IdeaCategory = "restaurant" | "bar" | "park" | "exercise" | "other";

export type DateIdea = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  social_link: string | null;
  category: IdeaCategory | null;
  category_other: string | null;
  cost_type: "free" | "budget";
  budget_amount: number | null;
  proposed_date: string | null;
  status: "suggested" | "scheduled" | "past";
  created_by: string | null;
  created_at: string;
};

export type Vote = {
  id: string;
  date_idea_id: string;
  participant_id: string;
  created_at: string;
};

export type Feedback = {
  id: string;
  participant_id: string | null;
  message: string;
  created_at: string;
};
