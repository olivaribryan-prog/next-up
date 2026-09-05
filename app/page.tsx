"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { supabase, Participant, DateIdea, Vote, IdeaCategory } from "@/lib/supabaseClient";

const SESSION_KEY = "next-up-participant";

type CostType = "free" | "budget";

const CATEGORY_LABELS: Record<IdeaCategory, string> = {
  restaurant: "Restaurant",
  bar: "Bar",
  park: "Park",
  exercise: "Exercise",
  other: "Other",
};

function categoryLabel(idea: DateIdea): string | null {
  if (!idea.category) return null;
  if (idea.category === "other") return idea.category_other?.trim() || "Other";
  return CATEGORY_LABELS[idea.category];
}

function loadSession(): Participant | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveSession(p: Participant) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(p));
}

function clearSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export default function Home() {
  const [me, setMe] = useState<Participant | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMe(loadSession());
    setReady(true);
  }, []);

  if (!ready) return null;
  if (!me) return <JoinGate onJoined={setMe} />;

  return <App me={me} onLeave={() => { clearSession(); setMe(null); }} />;
}

function JoinGate({ onJoined }: { onJoined: (p: Participant) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email.");
      return;
    }
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();

    const { data: existing, error: findErr } = await supabase
      .from("participants")
      .select("*")
      .eq("email", cleanEmail)
      .maybeSingle();

    if (findErr) {
      setError(findErr.message);
      setBusy(false);
      return;
    }

    if (existing) {
      saveSession(existing as Participant);
      onJoined(existing as Participant);
      return;
    }

    const { data: created, error: insertErr } = await supabase
      .from("participants")
      .insert({ name: name.trim(), email: cleanEmail })
      .select()
      .single();

    setBusy(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    saveSession(created as Participant);
    onJoined(created as Participant);
  }

  return (
    <div className="join-wrap">
      <div className="join-card">
        <img src="/friends-photo.jpg" alt="The crew" className="join-photo" />
        <div className="join-card-body">
          <div className="join-heading">
            <h1>Next Round</h1>
            <span className="beta-badge">Beta</span>
          </div>
          <p>Suggest plans, vote on your favorites, and keep track of what&rsquo;s coming up. Just tell us who you are.</p>
          <form onSubmit={handleSubmit}>
            <div>
              <label className="field-label" htmlFor="name">Name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label className="field-label" htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            {error && <span className="error-text">{error}</span>}
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "One sec…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function App({ me, onLeave }: { me: Participant; onLeave: () => void }) {
  const [tab, setTab] = useState<"poll" | "calendar">("poll");
  const [ideas, setIdeas] = useState<DateIdea[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [participants, setParticipants] = useState<Record<string, Participant>>({});
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [ideasRes, votesRes, peopleRes] = await Promise.all([
      supabase.from("date_ideas").select("*").order("created_at", { ascending: false }),
      supabase.from("votes").select("*"),
      supabase.from("participants").select("*"),
    ]);
    if (ideasRes.data) setIdeas(ideasRes.data as DateIdea[]);
    if (votesRes.data) setVotes(votesRes.data as Vote[]);
    if (peopleRes.data) {
      const map: Record<string, Participant> = {};
      (peopleRes.data as Participant[]).forEach((p) => (map[p.id] = p));
      setParticipants(map);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel("next-up-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "date_ideas" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, loadAll)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const votesByIdea = useMemo(() => {
    const map: Record<string, Vote[]> = {};
    votes.forEach((v) => {
      map[v.date_idea_id] = map[v.date_idea_id] || [];
      map[v.date_idea_id].push(v);
    });
    return map;
  }, [votes]);

  async function toggleVote(idea: DateIdea) {
    const mine = votesByIdea[idea.id]?.find((v) => v.participant_id === me.id);
    if (mine) {
      await supabase.from("votes").delete().eq("id", mine.id);
    } else {
      await supabase.from("votes").insert({ date_idea_id: idea.id, participant_id: me.id });
    }
  }

  async function addIdea(input: {
    title: string;
    description: string;
    location: string;
    social_link: string;
    category: IdeaCategory;
    category_other: string;
    cost_type: CostType;
    budget_amount: string;
    proposed_date: string;
  }) {
    await supabase.from("date_ideas").insert({
      title: input.title.trim(),
      description: input.description.trim() || null,
      location: input.location.trim() || null,
      social_link: input.social_link.trim() || null,
      category: input.category,
      category_other: input.category === "other" ? input.category_other.trim() || null : null,
      cost_type: input.cost_type,
      budget_amount: input.cost_type === "budget" && input.budget_amount ? Number(input.budget_amount) : null,
      proposed_date: input.proposed_date || null,
      created_by: me.id,
      status: "suggested",
    });
  }

  async function scheduleIdea(idea: DateIdea, date: string) {
    await supabase
      .from("date_ideas")
      .update({ proposed_date: date, status: "scheduled" })
      .eq("id", idea.id);
  }

  async function markPast(idea: DateIdea) {
    await supabase.from("date_ideas").update({ status: "past" }).eq("id", idea.id);
  }

  const pollIdeas = ideas
    .filter((i) => i.status === "suggested")
    .sort((a, b) => (votesByIdea[b.id]?.length || 0) - (votesByIdea[a.id]?.length || 0));

  const upcoming = ideas
    .filter((i) => i.status === "scheduled" && i.proposed_date)
    .sort((a, b) => (a.proposed_date! < b.proposed_date! ? -1 : 1));

  const past = ideas
    .filter((i) => i.status === "past")
    .sort((a, b) => (a.proposed_date && b.proposed_date ? (a.proposed_date < b.proposed_date ? 1 : -1) : 0));

  return (
    <div className="shell">
      <header className="header">
        <div className="wordmark">
          Next Round<span className="beta-badge">Beta</span>
          <span className="wordmark-sub">Date ideas, polls, and what&rsquo;s coming up</span>
        </div>
        <div className="whoami">
          {me.name}
          <button onClick={onLeave}>Not you? Switch</button>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === "poll" ? "active" : ""}`} onClick={() => setTab("poll")}>
          Ideas &amp; poll
        </button>
        <button className={`tab ${tab === "calendar" ? "active" : ""}`} onClick={() => setTab("calendar")}>
          Calendar
        </button>
      </nav>

      {loading ? (
        <p className="empty">Loading…</p>
      ) : tab === "poll" ? (
        <PollTab
          ideas={pollIdeas}
          votesByIdea={votesByIdea}
          participants={participants}
          me={me}
          onVote={toggleVote}
          onAdd={addIdea}
          onSchedule={scheduleIdea}
        />
      ) : (
        <CalendarTab upcoming={upcoming} past={past} participants={participants} onMarkPast={markPast} />
      )}

      <FeedbackFooter me={me} />
    </div>
  );
}

function PollTab({
  ideas,
  votesByIdea,
  participants,
  me,
  onVote,
  onAdd,
  onSchedule,
}: {
  ideas: DateIdea[];
  votesByIdea: Record<string, Vote[]>;
  participants: Record<string, Participant>;
  me: Participant;
  onVote: (idea: DateIdea) => void;
  onAdd: (input: {
    title: string;
    description: string;
    location: string;
    social_link: string;
    category: IdeaCategory;
    category_other: string;
    cost_type: CostType;
    budget_amount: string;
    proposed_date: string;
  }) => Promise<void>;
  onSchedule: (idea: DateIdea, date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<IdeaCategory>("restaurant");
  const [categoryOther, setCategoryOther] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [socialLink, setSocialLink] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [costType, setCostType] = useState<CostType>("free");
  const [budget, setBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    await onAdd({
      title,
      description,
      location,
      social_link: socialLink,
      category,
      category_other: categoryOther,
      cost_type: costType,
      budget_amount: budget,
      proposed_date: proposedDate,
    });
    setSubmitting(false);
    setTitle("");
    setCategory("restaurant");
    setCategoryOther("");
    setDescription("");
    setLocation("");
    setSocialLink("");
    setProposedDate("");
    setCostType("free");
    setBudget("");
    setOpen(false);
  }

  return (
    <div>
      <div className="section-heading">
        <h2>Suggestions</h2>
        <button className="btn secondary" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Suggest something"}
        </button>
      </div>

      {open && (
        <form className="form-grid card" onSubmit={handleSubmit} style={{ marginBottom: "1.75rem" }}>
          <input
            placeholder="Activity name — Place name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />

          <div className="form-row">
            <select value={category} onChange={(e) => setCategory(e.target.value as IdeaCategory)}>
              <option value="restaurant">Restaurant</option>
              <option value="bar">Bar</option>
              <option value="park">Park</option>
              <option value="exercise">Exercise</option>
              <option value="other">Other</option>
            </select>
            {category === "other" && (
              <input
                placeholder="What kind of activity?"
                value={categoryOther}
                onChange={(e) => setCategoryOther(e.target.value)}
              />
            )}
          </div>

          <textarea placeholder="Any details worth sharing" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />

          <input
            type="url"
            placeholder="Google Maps link"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />

          <input
            type="url"
            placeholder="Social media link (optional)"
            value={socialLink}
            onChange={(e) => setSocialLink(e.target.value)}
          />

          <div className="form-row">
            <div>
              <label className="field-label" htmlFor="proposed-date">Date, if you already know it (optional)</label>
              <input
                id="proposed-date"
                type="date"
                value={proposedDate}
                onChange={(e) => setProposedDate(e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="cost-toggle">
              <button type="button" className={costType === "free" ? "active" : ""} onClick={() => setCostType("free")}>
                Free
              </button>
              <button type="button" className={costType === "budget" ? "active" : ""} onClick={() => setCostType("budget")}>
                Has a cost
              </button>
            </div>
            {costType === "budget" && (
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Approx. cost ($)"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            )}
          </div>
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? "Adding…" : "Add to the poll"}
          </button>
        </form>
      )}

      {ideas.length === 0 ? (
        <p className="empty">No suggestions yet — add the first one.</p>
      ) : (
        <div className="idea-list">
          {ideas.map((idea) => {
            const ideaVotes = votesByIdea[idea.id] || [];
            const mine = ideaVotes.some((v) => v.participant_id === me.id);
            const suggester = idea.created_by ? participants[idea.created_by] : null;
            const cat = categoryLabel(idea);
            return (
              <div className="card idea-card" key={idea.id}>
                <div className="idea-main">
                  <h3>{idea.title}</h3>
                  {idea.description && <p className="idea-desc">{idea.description}</p>}
                  <div className="idea-meta">
                    {cat && <span className="tag category">{cat}</span>}
                    <span className={`tag ${idea.cost_type}`}>
                      {idea.cost_type === "free" ? "Free" : idea.budget_amount ? `~$${idea.budget_amount}` : "Has a cost"}
                    </span>
                    {idea.proposed_date && (
                      <span className="idea-location">📅 {formatDay(idea.proposed_date).month} {formatDay(idea.proposed_date).day}</span>
                    )}
                  </div>
                  {(idea.location || idea.social_link) && (
                    <div className="idea-links">
                      {idea.location && (
                        <a href={idea.location} target="_blank" rel="noreferrer">📍 Google Maps</a>
                      )}
                      {idea.social_link && (
                        <a href={idea.social_link} target="_blank" rel="noreferrer">🔗 Social</a>
                      )}
                    </div>
                  )}
                  {suggester && <div className="suggested-by">Suggested by {suggester.name}</div>}
                  <div className="schedule-row">
                    <input
                      type="date"
                      onChange={(e) => {
                        if (e.target.value) onSchedule(idea, e.target.value);
                      }}
                    />
                    <span className="idea-location">put it on the calendar</span>
                  </div>
                </div>
                <div className="vote-block">
                  <button className={`vote-btn ${mine ? "voted" : ""}`} onClick={() => onVote(idea)} aria-label="Vote for this idea">
                    {mine ? "✓" : "+"}
                  </button>
                  <span className="vote-count">{ideaVotes.length} vote{ideaVotes.length === 1 ? "" : "s"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return {
    day: d.getDate(),
    dow: d.toLocaleDateString(undefined, { weekday: "short" }),
    month: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

function CalendarTab({
  upcoming,
  past,
  participants,
  onMarkPast,
}: {
  upcoming: DateIdea[];
  past: DateIdea[];
  participants: Record<string, Participant>;
  onMarkPast: (idea: DateIdea) => void;
}) {
  const grouped = useMemo(() => {
    const map: Record<string, DateIdea[]> = {};
    upcoming.forEach((idea) => {
      const { month } = formatDay(idea.proposed_date!);
      map[month] = map[month] || [];
      map[month].push(idea);
    });
    return map;
  }, [upcoming]);

  return (
    <div>
      <div className="section-heading">
        <h2>Upcoming</h2>
      </div>
      {upcoming.length === 0 ? (
        <p className="empty">Nothing on the calendar yet — schedule an idea from the poll.</p>
      ) : (
        Object.entries(grouped).map(([month, items]) => (
          <div className="calendar-month" key={month}>
            <h3>{month}</h3>
            {items.map((idea) => {
              const { day, dow } = formatDay(idea.proposed_date!);
              const suggester = idea.created_by ? participants[idea.created_by] : null;
              const cat = categoryLabel(idea);
              return (
                <div className="calendar-item" key={idea.id}>
                  <div className="calendar-date">
                    <div className="day">{day}</div>
                    <div className="dow">{dow}</div>
                  </div>
                  <div className="idea-main" style={{ flex: 1 }}>
                    <h3>{idea.title}</h3>
                    {idea.description && <p className="idea-desc">{idea.description}</p>}
                    <div className="idea-meta">
                      {cat && <span className="tag category">{cat}</span>}
                      <span className={`tag ${idea.cost_type}`}>
                        {idea.cost_type === "free" ? "Free" : idea.budget_amount ? `~$${idea.budget_amount}` : "Has a cost"}
                      </span>
                    </div>
                    {(idea.location || idea.social_link) && (
                      <div className="idea-links">
                        {idea.location && (
                          <a href={idea.location} target="_blank" rel="noreferrer">📍 Google Maps</a>
                        )}
                        {idea.social_link && (
                          <a href={idea.social_link} target="_blank" rel="noreferrer">🔗 Social</a>
                        )}
                      </div>
                    )}
                    {suggester && <div className="suggested-by">Suggested by {suggester.name}</div>}
                  </div>
                  <button className="btn secondary" onClick={() => onMarkPast(idea)}>
                    Mark done
                  </button>
                </div>
              );
            })}
          </div>
        ))
      )}

      {past.length > 0 && (
        <div className="calendar-month">
          <h3>Past</h3>
          {past.map((idea) => (
            <div className="calendar-item" key={idea.id}>
              <div className="idea-main" style={{ flex: 1 }}>
                <h3>{idea.title}</h3>
                {idea.proposed_date && <div className="idea-location">{formatDay(idea.proposed_date).month}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackFooter({ me }: { me: Participant }) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSubmitting(true);
    await supabase.from("feedback").insert({ participant_id: me.id, message: message.trim() });
    setSubmitting(false);
    setSent(true);
    setMessage("");
    setTimeout(() => setSent(false), 4000);
  }

  return (
    <footer className="app-footer">
      <h3>Something not working? Got an idea?</h3>
      <p>Send a note straight to Bryan.</p>
      <form className="feedback-form" onSubmit={handleSubmit}>
        <textarea
          rows={2}
          placeholder="Tell Bryan what's up…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className="btn secondary" type="submit" disabled={submitting || !message.trim()}>
          {submitting ? "Sending…" : sent ? "Sent ✓" : "Send feedback"}
        </button>
      </form>
    </footer>
  );
}
