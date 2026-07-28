#!/usr/bin/env python3
"""
Measures how much an 8-team snake draft slot is actually worth, using live Sleeper
projections. Produced the 58.7-point figure that sets the $100 budget in SPEC.md §4.2.

Usage:  python3 tools/slot_value_sim.py [season]

Reads only public, auth-free Sleeper endpoints. Caches responses in .cache/.
"""
import json
import os
import sys
import urllib.request

SEASON = sys.argv[1] if len(sys.argv) > 1 else "2026"
TEAMS, ROUNDS = 8, 15
SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "K": 1, "DEF": 1}
FLEX = 1
BENCH_CAP = 3  # extra bodies allowed per position beyond startable slots
CACHE = os.path.join(os.path.dirname(__file__), ".cache")


def fetch(url, key):
    """Sleeper 403s on urllib's default User-Agent. Must send a browser-like one."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, key + ".json")
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            open(path, "wb").write(r.read())
    return json.load(open(path))


def load_players():
    """player_id -> {pts, pos, name}. Season projections only; ADP is on the week-1
    endpoint, which is a separate Sleeper quirk documented in SPEC.md §5.2."""
    out = {}
    for pos in SLOTS:
        url = (f"https://api.sleeper.com/projections/nfl/{SEASON}"
               f"?season_type=regular&position[]={pos}&order_by=pts_ppr")
        for rec in fetch(url, f"s_{SEASON}_{pos}"):
            pts = (rec.get("stats") or {}).get("pts_ppr")
            if not pts:
                continue
            p = rec.get("player") or {}
            name = rec.get("team") if pos == "DEF" else \
                f"{p.get('first_name','')} {p.get('last_name','')}".strip()
            out[rec["player_id"]] = {"pts": pts, "pos": pos, "name": name}
    return out


def draft(players):
    """Greedy best-available-by-projection snake, subject to positional caps."""
    board = sorted(players.items(), key=lambda kv: -kv[1]["pts"])
    rosters = {s: [] for s in range(1, TEAMS + 1)}
    taken = set()
    for rnd in range(1, ROUNDS + 1):
        order = range(1, TEAMS + 1) if rnd % 2 else range(TEAMS, 0, -1)
        for slot in order:
            counts = {}
            for _, v in rosters[slot]:
                counts[v["pos"]] = counts.get(v["pos"], 0) + 1
            for pid, v in board:
                if pid in taken:
                    continue
                cap = SLOTS[v["pos"]] + BENCH_CAP
                if v["pos"] in ("RB", "WR", "TE"):
                    cap += FLEX
                if counts.get(v["pos"], 0) >= cap:
                    continue
                rosters[slot].append((pid, v))
                taken.add(pid)
                break
    return rosters


def main():
    players = load_players()
    rosters = draft(players)
    totals = {s: sum(v["pts"] for _, v in r) for s, r in rosters.items()}
    avg = sum(totals.values()) / TEAMS

    print(f"{SEASON} — 8-team, 15-round snake, best-available by projection")
    print(f"{'slot':<6}{'roster pts':>12}{'vs avg':>10}")
    for s in range(1, TEAMS + 1):
        print(f"{s:<6}{totals[s]:>12.1f}{totals[s]-avg:>+10.1f}")

    spread = max(totals.values()) - min(totals.values())
    print(f"\nspread best-to-worst : {spread:.1f} pts  ({spread/14:.2f}/week)")
    print(f"as share of avg roster: {spread/avg*100:.1f}%")
    print("\nA 15-round snake equalizes slot value almost entirely. See SPEC.md §4.2 —")
    print("this is why the shared auction/FAAB budget is $100 rather than $200.")
    print("\nNOTE: a starters-only variant of this sim is NOT reliable — the greedy")
    print("heuristic leaves some slots with lopsided position groups no real drafter")
    print("would accept. Use the Phase 4 backtest with real models for that number.")


if __name__ == "__main__":
    main()
