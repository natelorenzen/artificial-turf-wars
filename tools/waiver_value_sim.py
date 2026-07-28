#!/usr/bin/env python3
"""
Measures what the waiver wire is actually worth, to price it against draft slot.

Produced the "one good waiver add ~= the entire draft-slot advantage" finding that
sets the shared $100 budget in SPEC.md §4.2. Pair with tools/slot_value_sim.py.

Method: treat the top 120 players by preseason ADP as "drafted" in an 8-team league,
then measure what the best UNDRAFTED player at each position actually scored against a
replacement-level starter. Uses a completed season so the numbers are actuals, not
projections.

Usage:  python3 tools/waiver_value_sim.py [season]   (default 2025)
"""
import json
import os
import sys
import urllib.request

SEASON = sys.argv[1] if len(sys.argv) > 1 else "2025"
POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"]
DRAFT_POOL = 120  # 8 teams x 15 rounds

# League-wide startable slots per position in an 8-team league. RB/WR/TE are inflated
# above their base slots to absorb the FLEX, which is why replacement level sits deeper.
STARTABLE = {"QB": 8, "RB": 20, "WR": 20, "TE": 10, "K": 8, "DEF": 8}
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


def load():
    """Returns (adp, actual, name, position) keyed by player_id.

    ADP comes from the WEEK-1 projections endpoint, not the season-long one, which
    returns null for every player. See SPEC.md §5.2.
    """
    adp, actual, name, position = {}, {}, {}, {}
    for pos in POSITIONS:
        base = "https://api.sleeper.com"
        for rec in fetch(f"{base}/projections/nfl/{SEASON}/1?season_type=regular"
                         f"&position[]={pos}&order_by=pts_ppr", f"adp_{SEASON}_{pos}"):
            a = (rec.get("stats") or {}).get("adp_dd_ppr")
            if a and a < 1000:  # 1000 is Sleeper's "unranked" sentinel, not an ADP
                adp[rec["player_id"]] = a
        for rec in fetch(f"{base}/stats/nfl/{SEASON}?season_type=regular"
                         f"&position[]={pos}&order_by=pts_ppr", f"act_{SEASON}_{pos}"):
            pts = (rec.get("stats") or {}).get("pts_ppr")
            if not pts:
                continue
            pid = rec["player_id"]
            actual[pid] = pts
            position[pid] = pos
            p = rec.get("player") or {}
            name[pid] = rec.get("team") if pos == "DEF" else \
                f"{p.get('first_name','')} {p.get('last_name','')}".strip()
    return adp, actual, name, position


def main():
    adp, actual, name, position = load()
    drafted = set(sorted(adp, key=lambda k: adp[k])[:DRAFT_POOL])

    print(f"{SEASON}: marginal value of the best waiver add over a replacement starter")
    print(f"(8-team league, top-{DRAFT_POOL} ADP treated as drafted)\n")
    print(f"{'pos':<5}{'best undrafted':>28}{'pts':>8}{'replacement':>13}{'MARGIN':>9}")

    margins = []
    for pos in POSITIONS:
        ranked = sorted(((actual[k], k) for k in actual if position[k] == pos),
                        reverse=True)
        taken = [x for x in ranked if x[1] in drafted]
        free = [x for x in ranked if x[1] not in drafted]
        if not free or not taken:
            continue
        repl = taken[min(STARTABLE[pos], len(taken)) - 1][0]
        best = free[0]
        margin = best[0] - repl
        margins.append(margin)
        print(f"{pos:<5}{name[best[1]]:>28}{best[0]:>8.1f}{repl:>13.1f}{margin:>+9.1f}")

    print(f"\nbest single waiver add : {max(margins):+.1f} pts over the season")
    print("draft-slot spread      :  58.7 pts  (tools/slot_value_sim.py)")
    print("\nOne good in-season add is worth roughly the same as the entire")
    print("best-to-worst draft slot advantage. That exchange rate is why the")
    print("auction and FAAB share one $100 budget rather than being split.")


if __name__ == "__main__":
    main()
