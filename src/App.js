import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import ProfileManager from './ProfileManager';

/**
 * Dynamic GTO Poker Chart + Testing Mode (EV Monte Carlo)
 *
 * - Adds a Testing Mode tab that runs Monte Carlo equities & EV sims between our chart (adjustedStrategy)
 *   and an opponent profile (baselineGTO).
 *
 * Notes:
 * - Preflop-focused EV model.
 * - Monte Carlo sampler (200 sims default) for showdown equities.
 * - Simplified pot arithmetic: pot, raiseSize, callSize are user inputs.
 *
 * Performance:
 * - Increasing simulations per matchup increases accuracy but slows UI (runs in-browser).
 */

const PokerChart = () => {
  // Hand rankings from AA (top-left) to 22 (bottom-right)
  const ranks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

  // Baseline GTO strategy (simplified preflop ranges)
  const baselineGTO = {
    // Pairs
    'AA': { fold: 0, call: 0, raise: 100 },
    'KK': { fold: 0, call: 5, raise: 95 },
    'QQ': { fold: 0, call: 15, raise: 85 },
    'JJ': { fold: 5, call: 25, raise: 70 },
    'TT': { fold: 10, call: 30, raise: 60 },
    '99': { fold: 20, call: 40, raise: 40 },
    '88': { fold: 30, call: 50, raise: 20 },
    '77': { fold: 40, call: 45, raise: 15 },
    '66': { fold: 50, call: 35, raise: 15 },
    '55': { fold: 60, call: 30, raise: 10 },
    '44': { fold: 70, call: 25, raise: 5 },
    '33': { fold: 80, call: 18, raise: 2 },
    '22': { fold: 85, call: 15, raise: 0 },

    // Suited connectors and broadway
    'AKs': { fold: 0, call: 10, raise: 90 },
    'AQs': { fold: 0, call: 20, raise: 80 },
    'AJs': { fold: 5, call: 25, raise: 70 },
    'ATs': { fold: 10, call: 30, raise: 60 },
    'KQs': { fold: 15, call: 35, raise: 50 },
    'KJs': { fold: 25, call: 40, raise: 35 },
    'QJs': { fold: 35, call: 45, raise: 20 },
    'JTs': { fold: 40, call: 50, raise: 10 },
    'T9s': { fold: 60, call: 35, raise: 5 },
    '98s': { fold: 70, call: 28, raise: 2 },
    '87s': { fold: 80, call: 20, raise: 0 },

    // Offsuit broadway
    'AKo': { fold: 0, call: 15, raise: 85 },
    'AQo': { fold: 10, call: 30, raise: 60 },
    'AJo': { fold: 20, call: 40, raise: 40 },
    'ATo': { fold: 35, call: 45, raise: 20 },
    'KQo': { fold: 40, call: 50, raise: 10 },
    'KJo': { fold: 55, call: 40, raise: 5 },
    'QJo': { fold: 70, call: 28, raise: 2 },
    'JTo': { fold: 80, call: 20, raise: 0 },
  };

  const [opponentStats, setOpponentStats] = useState({
    foldTo3Bet: 65,
    observed3BetFold: 45,
    handsPlayed: 0,
  });

  // Handler for profile changes
  const handleProfileChange = (profile) => {
    setCurrentProfile(profile);
    
    // Update the chart title and exploitation display
    if (profile && profile.id !== 'baseline') {
      setShowExploitation(true); // Always show exploits when using a profile
    }
  };

  const [adjustedStrategy, setAdjustedStrategy] = useState(baselineGTO);
  const [selectedHand, setSelectedHand] = useState(null);
  const [showExploitation, setShowExploitation] = useState(true);

  // profile state
  const [currentProfile, setCurrentProfile] = useState(null);

   // Add missing profile-related state
  const [profiles, setProfiles] = useState({
    'baseline': { 
      id: 'baseline', 
      name: 'GTO Baseline', 
      strategy: baselineGTO,
      stats: { vpip: 23, foldTo3Bet: 65 }
    }
  });
  
  // Testing mode profile selection state
  const [heroProfile, setHeroProfile] = useState('current'); // 'current' uses adjustedStrategy
  const [villainProfile, setVillainProfile] = useState('baseline');


  // Realtime analysis state
  const [isPlaying, setIsPlaying] = useState(true);
  const [hps, setHps] = useState(3);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nowAnalyzing, setNowAnalyzing] = useState(null);
  const [feed, setFeed] = useState([]);
  const FEED_LIMIT = 30;

  const handleRunSim = async () => {
    setSimResults(null);
    setSimRunning(true);
    
    try {
      const heroStrategy = getProfileStrategy(heroProfile, profiles, adjustedStrategy, baselineGTO);
      const oppStrategy = getProfileStrategy(villainProfile, profiles, adjustedStrategy, baselineGTO);
      
      const r = await runSimulation({
        heroStrategy,
        oppStrategy,
        simsPerMatchup: simParams.simsPerMatchup,
        potSize: simParams.potSize,
        raiseSize: simParams.raiseSize,
        callSize: simParams.callSize,
        sample: simParams.sampleHands,
      });
      
      setSimResults(r);
    } catch (error) {
      console.error('Simulation error:', error);
    } finally {
      setSimRunning(false);
    }
  };

  // Profile comparison feature state
  const [compareProfile, setCompareProfile] = useState(null);
  
  // Testing mode state
  const [mode, setMode] = useState('analysis'); // 'analysis' | 'testing'
  const [simResults, setSimResults] = useState(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simParams, setSimParams] = useState({
    simsPerMatchup: 200,
    potSize: 1,
    raiseSize: 1, // extra hero puts in for raise (hero invests this when raising)
    callSize: 1,  // hero cost when calling an open
    sampleHands: 'all', // or 'sample' - reserve option
  });

  // Build the full 169-hand matrix keys
  const all169 = useMemo(() => {
    const keys = [];
    for (let i = 0; i < ranks.length; i++) {
      for (let j = 0; j < ranks.length; j++) {
        if (i === j) keys.push(ranks[i] + ranks[j]);
        else if (i < j) keys.push(ranks[i] + ranks[j] + 's');
        else keys.push(ranks[j] + ranks[i] + 'o');
      }
    }
    return keys;
  }, [ranks]);

  const shuffled169 = useMemo(() => shuffle(all169), [all169]);
  const speedRef = useRef(hps);
  const playingRef = useRef(isPlaying);

  useEffect(() => { speedRef.current = hps; }, [hps]);
  useEffect(() => { playingRef.current = isPlaying; }, [isPlaying]);

  // Simulate opponent data collection
  useEffect(() => {
    const interval = setInterval(() => {
      setOpponentStats((prev) => ({
        ...prev,
        handsPlayed: prev.handsPlayed + 1,
        observed3BetFold: Math.max(30, prev.observed3BetFold + (Math.random() - 0.6) * 2),
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Dynamic strategy adjustment based on opponent tendencies
  useEffect(() => {
    if (currentProfile && currentProfile.strategy) {
      // Use the profile's pre-calculated strategy instead of real-time adjustments
      setAdjustedStrategy(currentProfile.strategy);
    } else {
      if (opponentStats.handsPlayed < 5) return;
      const foldDeviation = opponentStats.foldTo3Bet - opponentStats.observed3BetFold;
      const adjustmentFactor = Math.min(Math.abs(foldDeviation) / 100, 0.3);

      const newStrategy = {};
      Object.keys(baselineGTO).forEach((hand) => {
        const baseline = baselineGTO[hand];
        if (foldDeviation > 10) {
          newStrategy[hand] = {
            fold: Math.min(100, baseline.fold + adjustmentFactor * 30),
            call: Math.max(0, baseline.call - adjustmentFactor * 15),
            raise: Math.max(0, baseline.raise - adjustmentFactor * 15),
          };
        } else if (foldDeviation < -10) {
          newStrategy[hand] = {
            fold: Math.max(0, baseline.fold - adjustmentFactor * 20),
            call: baseline.call + adjustmentFactor * 10,
            raise: baseline.raise + adjustmentFactor * 10,
          };
        } else {
          newStrategy[hand] = baseline;
        }
      });

      setAdjustedStrategy(newStrategy);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [currentProfile, opponentStats]);

  // Realtime hand analysis ticker
  useEffect(() => {
    if (!shuffled169.length) return;
    let rafId;
    let last = performance.now();
    const step = (now) => {
      const elapsed = now - last;
      const intervalMs = 1000 / Math.max(1, speedRef.current);
      if (playingRef.current && elapsed >= intervalMs) {
        last = now;
        setCurrentIndex((prev) => {
          const next = (prev + 1) % shuffled169.length;
          const hand = shuffled169[next];
          setNowAnalyzing(hand);
          setFeed((f) => {
            const item = makeFeedItem(hand, adjustedStrategy, baselineGTO);
            const nextFeed = [item, ...f];
            if (nextFeed.length > FEED_LIMIT) nextFeed.pop();
            return nextFeed;
          });
          return next;
        });
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffled169, adjustedStrategy]);

  const getActionColor = (hand) => {
    if (!hand) return 'bg-gray-100';
    const strategy = showExploitation
      ? adjustedStrategy[hand] || { fold: 100, call: 0, raise: 0 }
      : baselineGTO[hand] || { fold: 100, call: 0, raise: 0 };

    const { fold, call, raise } = strategy;
    if (raise >= 60) return 'bg-red-500';
    if (raise >= 30) return 'bg-red-300';
    if (call >= 40) return 'bg-blue-500';
    if (call >= 20) return 'bg-blue-300';
    return 'bg-gray-300';
  };

  const getTextColor = (hand) => {
    if (!hand) return 'text-gray-400';
    const color = getActionColor(hand);
    return color.includes('gray') ? 'text-gray-600' : 'text-white';
  };

  const getStrategyData = () => {
    if (!selectedHand) return [];
    const baseline = baselineGTO[selectedHand] || { fold: 100, call: 0, raise: 0 };
    const adjusted = adjustedStrategy[selectedHand] || { fold: 100, call: 0, raise: 0 };
    return [
      { action: 'Fold', baseline: baseline.fold, adjusted: adjusted.fold },
      { action: 'Call', baseline: baseline.call, adjusted: adjusted.call },
      { action: 'Raise', baseline: baseline.raise, adjusted: adjusted.raise },
    ];
  };

  const progressPct = Math.round(((currentIndex + 1) / 169) * 100);

  // ---- Testing Mode: EV Monte Carlo ----

  // Convert strategy object (hand -> {fold, call, raise}) to a range probability map
  // We'll interpret "raise" probability as portion of times that hand leads to a raise, etc.
  function strategyToRangeProbMap(strategy) {
    const map = {};
    Object.keys(strategy).forEach((hand) => {
      const s = strategy[hand];
      const total = (s.fold || 0) + (s.call || 0) + (s.raise || 0) || 1;
      map[hand] = {
        fold: (s.fold || 0) / total,
        call: (s.call || 0) / total,
        raise: (s.raise || 0) / total,
      };
    });
    return map;
  }

  // Generate a deck of cards
  function makeDeck() {
    const ranksLocal = '23456789TJQKA';
    const suits = ['s', 'h', 'd', 'c'];
    const deck = [];
    for (const r of ranksLocal) {
      for (const s of suits) {
        deck.push(r + s);
      }
    }
    return deck;
  }

  // Map our two-letter/three-letter keys like "AKs" to all possible card combos (without order duplicates)
  function combosForHandKey(key) {
    // key like 'AKs' or 'QJo' or '99'
    const rankOrder = 'AKQJT98765432';
    const r1 = key[0];
    const r2 = key[1];
    const suited = key.length === 3 && key[2] === 's';
    const offsuit = key.length === 3 && key[2] === 'o';
    const combos = [];
    const suits = ['s', 'h', 'd', 'c'];

    if (r1 === r2) {
      // pocket pair: all combinations of two suits
      for (let i = 0; i < suits.length; i++) {
        for (let j = i + 1; j < suits.length; j++) {
          combos.push([r1 + suits[i], r2 + suits[j]]);
        }
      }
    } else if (suited) {
      for (let s of suits) {
        combos.push([r1 + s, r2 + s]);
      }
    } else if (offsuit) {
      for (let s1 of suits) {
        for (let s2 of suits) {
          if (s1 === s2) continue;
          combos.push([r1 + s1, r2 + s2]);
        }
      }
      // remove duplicates for reversed ranks
    } else {
      // if no suffix given, treat as offsuit (fallback)
      for (let s1 of suits) {
        for (let s2 of suits) {
          if (s1 === s2) continue;
          combos.push([r1 + s1, r2 + s2]);
        }
      }
    }
    return combos;
  }

  // Draw random distinct cards from deck, avoid blocked cards
  function drawRandomCards(deck, count, blocked = new Set()) {
    const remaining = deck.filter((c) => !blocked.has(c));
    const chosen = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * remaining.length);
      chosen.push(remaining.splice(idx, 1)[0]);
    }
    return chosen;
  }

  // Convert rank char to numeric value for evaluation convenience
  const rankToValue = {
    '2': 2, '3': 3, '4': 4, '5':5, '6':6, '7':7, '8':8, '9':9, 'T':10, 'J':11, 'Q':12, 'K':13, 'A':14
  };

  // Evaluate 7-card best hand and return {category, tiebreaker array}
  function evaluate7(cards) {
    // cards: array like ['As','Kd','Th',...]
    // Build rank counts & suit groups
    const ranks = {};
    const suits = {};
    const ranksList = [];
    for (const c of cards) {
      const r = c[0];
      const s = c[1];
      ranks[r] = (ranks[r] || 0) + 1;
      suits[s] = suits[s] || [];
      suits[s].push(c);
    }
    for (const r in ranks) ranksList.push(r);

    // Helper: convert rank array to sorted numeric descending unique list (Ace high)
    function rankNumsSorted(arr) {
      const nums = [...new Set(arr.map((r) => rankToValue[r]))].sort((a,b) => b - a);
      return nums;
    }

    // Check for flush
    let flushSuit = null;
    for (const s in suits) {
      if (suits[s].length >= 5) { flushSuit = s; break; }
    }

    // Check for straight (consider Ace low)
    const allRankNums = [];
    for (const r in ranks) allRankNums.push(rankToValue[r]);
    const uniq = [...new Set(allRankNums)].sort((a,b) => a - b);
    // add Ace as 1 for wheel
    if (uniq.includes(14)) uniq.unshift(1);
    let straightTop = null;
    for (let i = 0; i <= uniq.length - 5; i++) {
      // check consecutive run of length 5
      let run = true;
      for (let k = 1; k < 5; k++) {
        if (uniq[i + k] !== uniq[i] + k) { run = false; break; }
      }
      if (run) {
        straightTop = uniq[i+4]; // highest card
      }
    }
    // If multiple straights, choose highest top
    if (straightTop === null && uniq.length >= 5) {
      // scan from end
      for (let i = uniq.length - 1; i >= 4; i--) {
        const a = uniq[i], b = uniq[i-1], c = uniq[i-2], d = uniq[i-3], e = uniq[i-4];
        if (a === b+1 && b === c+1 && c === d+1 && d === e+1) { straightTop = a; break; }
      }
    }

    // Straight flush
    if (flushSuit) {
      const flushCards = suits[flushSuit].map((c)=>c[0]);
      const nums = [...new Set(flushCards.map((r)=>rankToValue[r]))].sort((a,b)=>a-b);
      if (nums.includes(14)) nums.unshift(1);
      let sfTop = null;
      for (let i = 0; i <= nums.length - 5; i++) {
        let run = true;
        for (let k = 1; k < 5; k++) {
          if (nums[i + k] !== nums[i] + k) { run = false; break; }
        }
        if (run) sfTop = nums[i+4];
      }
      if (sfTop !== null) return { rank: 8, tiebreak: [sfTop] }; // Straight flush
    }

    // Four of a kind
    let quadsRank = null;
    for (const r in ranks) if (ranks[r] === 4) quadsRank = rankToValue[r];
    if (quadsRank) {
      // kicker = highest remaining
      const kickers = Object.keys(ranks).filter((r)=>rankToValue[r] !== quadsRank)
        .map((r)=>rankToValue[r]).sort((a,b)=>b-a);
      return { rank: 7, tiebreak: [quadsRank, kickers[0]] };
    }

    // Full house (three + pair)
    const trips = Object.keys(ranks).filter((r)=>ranks[r]===3).map((r)=>rankToValue[r]).sort((a,b)=>b-a);
    const pairs = Object.keys(ranks).filter((r)=>ranks[r]===2).map((r)=>rankToValue[r]).sort((a,b)=>b-a);
    if (trips.length >= 1 && (pairs.length >= 1 || trips.length >= 2)) {
      // best trips as trips[0], best pair as either pairs[0] or trips[1]
      const three = trips[0];
      let pair = pairs[0] || trips[1];
      return { rank: 6, tiebreak: [three, pair] };
    }

    // Flush
    if (flushSuit) {
      const vals = suits[flushSuit].map((c)=>rankToValue[c[0]]).sort((a,b)=>b-a).slice(0,5);
      return { rank: 5, tiebreak: vals };
    }

    // Straight
    if (straightTop !== null) return { rank: 4, tiebreak: [straightTop] };

    // Three of a kind
    if (trips.length >= 1) {
      const three = trips[0];
      const kickers = Object.keys(ranks).filter((r)=>rankToValue[r] !== three)
        .map((r)=>rankToValue[r]).sort((a,b)=>b-a).slice(0,2);
      return { rank: 3, tiebreak: [three, ...kickers] };
    }

    // Two pair
    if (pairs.length >= 2) {
      const top1 = pairs[0], top2 = pairs[1];
      const kicker = Object.keys(ranks).filter((r)=>rankToValue[r] !== top1 && rankToValue[r] !== top2)
        .map((r)=>rankToValue[r]).sort((a,b)=>b-a)[0];
      return { rank: 2, tiebreak: [top1, top2, kicker] };
    }

    // One pair
    if (pairs.length === 1) {
      const pair = pairs[0];
      const kickers = Object.keys(ranks).filter((r)=>rankToValue[r] !== pair)
        .map((r)=>rankToValue[r]).sort((a,b)=>b-a).slice(0,3);
      return { rank: 1, tiebreak: [pair, ...kickers] };
    }

    // High card
    const highcards = Object.keys(ranks).map((r)=>rankToValue[r]).sort((a,b)=>b-a).slice(0,5);
    return { rank: 0, tiebreak: highcards };
  }

  // Compare two evaluated hands
  function compareEvals(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    // compare tiebreak arrays lexicographically
    for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
      const av = a.tiebreak[i] || 0;
      const bv = b.tiebreak[i] || 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }

  // Estimate equity of heroHand vs oppHand by Monte Carlo sampling of boards
  function estimateEquity(heroCards, oppCards, sims = 200) {
    // heroCards, oppCards: arrays of 2 card strings each
    // return {heroWins, oppWins, ties, equityHero}
    let heroWins = 0, oppWins = 0, ties = 0;
    const deck = makeDeck();
    const blocked = new Set([...heroCards, ...oppCards]);

    for (let s = 0; s < sims; s++) {
      const board = drawRandomCards(deck, 5, blocked);
      const heroEval = evaluate7([...heroCards, ...board]);
      const oppEval = evaluate7([...oppCards, ...board]);
      const cmp = compareEvals(heroEval, oppEval);
      if (cmp > 0) { heroWins++; }
      else if (cmp < 0) { oppWins++; }
      else { ties++; }
    }

    const equityHero = (heroWins + ties * 0.5) / sims;
    return { heroWins, oppWins, ties, equityHero };
  }

  // Sample a random hand combination for a given hand key, respecting blockers
  function sampleHandForKey(key, blocked = new Set()) {
    const combos = combosForHandKey(key);
    // filter combos that conflict with blocked
    const filtered = combos.filter((pair) => !blocked.has(pair[0]) && !blocked.has(pair[1]));
    if (filtered.length === 0) return null;
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    return pick;
  }

  // Create an opponent sampling distribution across specific actions:
  // For a given hero action (e.g., Raise), opponent's per-hand probabilities determine
  // whether they fold (gives pot), call/raise (leads to showdown) - we approximate by sampling an opp hand and
  // choosing to fold or continue according to the opponent's action probabilities for that hand.
  async function runSimulation({
    heroStrategy = adjustedStrategy,
    oppStrategy = baselineGTO,
    simsPerMatchup = 200,
    potSize = 1,
    raiseSize = 1,
    callSize = 1,
    sample = 'all',
  }) {
    setSimRunning(true);
    await new Promise((r) => setTimeout(r, 30)); // allow UI breathe

    const heroRange = strategyToRangeProbMap(heroStrategy);
    const oppRange = strategyToRangeProbMap(oppStrategy);
    const deckBase = makeDeck();

    const handKeys = sample === 'all' ? all169 : shuffled169.slice(0, 50);

    // accumulator results
    const accum = {
      totalMatchups: 0,
      actions: {
        Fold: { evSum: 0, count: 0 },
        Call: { evSum: 0, count: 0 },
        Raise: { evSum: 0, count: 0 },
      },
      perHandStats: {}, // hand -> {avgEVs}
    };

    // For each hero hand we evaluate EV per action by sampling random opponent hands (weighted by opp range)
    for (const handKey of handKeys) {
      const heroCombos = combosForHandKey(handKey);
      // approximate hero selection by assuming uniform among that hand's combos
      // We'll evaluate the representative hero combo by sampling combos for the heroKey
      const perHand = { hand: handKey, ev: { Fold: 0, Call: 0, Raise: 0 }, sims: 0 };

      // We'll run N trials where we:
      // - sample a hero combo for the handKey
      // - sample an opponent hand from their entire range (weighted by opp "raise/call/fold" mass)
      // - depending on hero action, follow outcomes and compute payoff
      const trials = Math.max(40, Math.min(400, Math.floor(simsPerMatchup / (handKeys.length / 40) || 200)));
      // to avoid too-long loops, we'll clamp total per-hand sims reasonable

      for (let t = 0; t < trials; t++) {
        // sample hero combo (avoid conflicts)
        const heroCombo = heroCombos[Math.floor(Math.random() * heroCombos.length)];
        const blocked = new Set([heroCombo[0], heroCombo[1]]);

        // sample an opponent hand key according to opp overall mass (sum of raise+call+fold weights)
        const oppKeys = Object.keys(oppRange);
        // build weights proportional to (fold+call+raise)
        const weights = oppKeys.map((k) => {
          const s = oppStrategy[k] || { fold: 100, call: 0, raise: 0 };
          return (s.fold || 0) + (s.call || 0) + (s.raise || 0);
        });
        // pick a random opponent key by weights
        let sumW = weights.reduce((a,b)=>a+b,0);
        let r = Math.random() * sumW;
        let idx = 0;
        while (r > 0 && idx < weights.length - 1) { r -= weights[idx]; idx++; }
        const oppKey = oppKeys[Math.max(0, idx- (r<=0?0:1))] || oppKeys[0];

        // sample opp combo that doesn't conflict
        const oppCombo = sampleHandForKey(oppKey, blocked);
        if (!oppCombo) { t--; continue; } // try again

        // Compute outcomes for each hero action
        // Baseline assumptions:
        // - potSize before hero action is potSize
        // - If hero folds: EV = - (heroCurrentInvestment) ; we'll assume hero has 0 invested (we're evaluating a decision pre-commit) so EV=0 for fold baseline
        //   (but since fold simply avoids losing further money, we set fold EV = 0)
        // - If hero raises (size=raiseSize): opponent either folds or calls/all-in.
        //    * if opp folds: hero wins current pot (potSize)
        //    * if opp calls: we run equity simulation and apply pot arithmetic:
        //        heroContribution = raiseSize; oppContribution = callSize (we assume callSize equals raiseSize for simplicity)
        //        totalPot = potSize + heroContribution + oppContribution
        //        EV_hero = equityHero * totalPot - heroContribution
        // - If hero calls (size=callSize) against some opp bet: similar to above where both put callSize
        // NOTE: This is simplified but gives consistent relative EVs.

        // First, estimate equity for showdown between heroCombo and oppCombo
        const equity = estimateEquity(heroCombo, oppCombo, Math.max(80, Math.min(500, Math.floor(simsPerMatchup / 2)))); // moderate sims per showdown

        // Evaluate Fold
        const EV_fold = 0; // assumption: folding pre-action means net 0 relative (no extra commitment)

        // Evaluate Raise (opp may fold depending on its per-hand fold probability)
        const oppProbFold = (oppStrategy[oppKey] && oppStrategy[oppKey].fold !== undefined)
          ? (oppStrategy[oppKey].fold / ((oppStrategy[oppKey].fold || 0) + (oppStrategy[oppKey].call || 0) + (oppStrategy[oppKey].raise || 0)))
          : 0.2;
        const oppProbCallOrContinue = 1 - oppProbFold;
        const heroContribution = raiseSize;
        const oppContribution = callSize;
        const totalPotRaise = potSize + heroContribution + oppContribution;
        const EV_showdown_raise = equity.equityHero * totalPotRaise - heroContribution;
        const EV_raise = oppProbFold * potSize + oppProbCallOrContinue * EV_showdown_raise;

        // Evaluate Call (opp put a bet, hero calls)
        // Need to model probability that opponent actually put that bet — to keep it simple assume the scenario is hero faces a bet and decides to call.
        // We'll evaluate call EV as showdown EV where both commit callSize (hero pays callSize).
        const totalPotCall = potSize + callSize + callSize; // both invest callSize
        const EV_call = equity.equityHero * totalPotCall - callSize;

        // accumulate
        perHand.ev.Fold += EV_fold;
        perHand.ev.Raise += EV_raise;
        perHand.ev.Call += EV_call;
        perHand.sims += 1;

        // global accum
        accum.actions.Fold.evSum += EV_fold; accum.actions.Fold.count++;
        accum.actions.Call.evSum += EV_call; accum.actions.Call.count++;
        accum.actions.Raise.evSum += EV_raise; accum.actions.Raise.count++;
        accum.totalMatchups++;
      }

      // average for this hand
      perHand.ev.Fold = perHand.ev.Fold / perHand.sims;
      perHand.ev.Call = perHand.ev.Call / perHand.sims;
      perHand.ev.Raise = perHand.ev.Raise / perHand.sims;
      accum.perHandStats[handKey] = perHand;
    }

    // finalize averages
    const results = {
      totalMatchups: accum.totalMatchups,
      actions: {
        Fold: { avgEV: accum.actions.Fold.evSum / Math.max(1, accum.actions.Fold.count), count: accum.actions.Fold.count },
        Call: { avgEV: accum.actions.Call.evSum / Math.max(1, accum.actions.Call.count), count: accum.actions.Call.count },
        Raise: { avgEV: accum.actions.Raise.evSum / Math.max(1, accum.actions.Raise.count), count: accum.actions.Raise.count },
      },
      perHand: accum.perHandStats,
    };

    setSimRunning(false);
    setSimResults(results);
    return results;
  }

  // Handler for running simulation
  const runSimHandler = async () => {
    setSimResults(null);
    
    // Use current profile as hero, baseline as opponent (or let user select both)
    const heroStrategy = currentProfile?.strategy || adjustedStrategy;
    const oppStrategy = baselineGTO; // Could be made configurable
    
    const r = await runSimulation({
      heroStrategy,
      oppStrategy,
      simsPerMatchup: simParams.simsPerMatchup,
      potSize: simParams.potSize,
      raiseSize: simParams.raiseSize,
      callSize: simParams.callSize,
      sample: simParams.sampleHands,
    });
    console.log('Simulation finished', r);
  };

  // ---- UI ----

  return (
    <div className="p-4 max-w-full mx-auto bg-gradient-to-br from-green-900 to-green-700 min-h-screen">
      <div className="bg-white rounded-xl shadow-2xl overflow-hidden">
        
        {/* Header with controls */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Dynamic GTO Poker Chart</h1>
            
            <div className="flex items-center gap-3">
              <div className="flex rounded-md bg-gray-100 p-1">
                <button
                  onClick={() => setMode('analysis')}
                  className={`px-3 py-1 text-sm rounded ${mode === 'analysis' ? 'bg-white shadow' : 'text-gray-600'}`}
                >
                  Analysis
                </button>
                <button
                  onClick={() => setMode('testing')}
                  className={`px-3 py-1 text-sm rounded ${mode === 'testing' ? 'bg-white shadow' : 'text-gray-600'}`}
                >
                  Testing
                </button>
                <button
                  onClick={() => setMode('profiles')}
                  className={`px-3 py-1 text-sm rounded ${mode === 'profiles' ? 'bg-white shadow' : 'text-gray-600'}`}
                >
                  Profiles
                </button>
              </div>

              <button
                onClick={() => setIsPlaying((p) => !p)}
                className={`px-4 py-2 text-sm font-medium rounded-md shadow transition-colors ${
                  isPlaying 
                    ? 'bg-red-600 hover:bg-red-700 text-white' 
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}
              >
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600 whitespace-nowrap">Speed</label>
                <input
                  type="range"
                  min={1}
                  max={15}
                  value={hps}
                  onChange={(e) => setHps(Number(e.target.value))}
                  className="w-16"
                />
                <span className="text-xs text-gray-700 w-8 text-right">{hps}x</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main content - responsive grid */}
        <div className="p-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* Column 1: Opponent Stats or Testing Controls */}
            <div className="bg-gray-50 p-6 rounded-lg">
              {mode === 'analysis' ? (
                <>
                  <h3 className="text-lg font-semibold mb-4 text-gray-700">Opponent Analysis</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span>Hands Observed:</span>
                      <span className="font-semibold">{opponentStats.handsPlayed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>GTO Fold vs 3-Bet:</span>
                      <span className="font-semibold">{opponentStats.foldTo3Bet}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Observed Fold vs 3-Bet:</span>
                      <span className="font-semibold">{Math.round(opponentStats.observed3BetFold)}%</span>
                    </div>
                    
                    <div className="pt-2">
                      <span className={`px-3 py-1 rounded text-xs font-semibold ${
                        opponentStats.observed3BetFold < 50 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {opponentStats.observed3BetFold < 50 ? 'Too Loose' : 'Standard'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 space-y-4">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={showExploitation}
                        onChange={(e) => setShowExploitation(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm">Show Exploitative Adjustments</span>
                    </label>

                    {/* pass progress */}
                    <div>
                      <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
                        <span>Analysis Pass Progress</span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-3 bg-emerald-500 rounded-full transition-all duration-300" 
                             style={{ width: `${progressPct}%` }} />
                      </div>
                      <div className="mt-2 text-xs text-gray-600">
                        Hand {currentIndex + 1} of 169
                      </div>
                    </div>
                  </div>
                </>
              ) : mode === 'testing' ? (
                <>
                  <h3 className="text-lg font-semibold mb-4 text-gray-700">Testing Controls</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span>Simulations / matchup</span>
                      <input type="number" min={20} max={2000} value={simParams.simsPerMatchup} onChange={(e)=>setSimParams({...simParams, simsPerMatchup: Math.max(20, Math.min(2000, Number(e.target.value)))})} className="w-20 p-1 border rounded"/>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Pot size</span>
                      <input type="number" min={0.1} step={0.1} value={simParams.potSize} onChange={(e)=>setSimParams({...simParams, potSize: Math.max(0.1, Number(e.target.value))})} className="w-20 p-1 border rounded"/>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Raise size (hero)</span>
                      <input type="number" min={0.1} step={0.1} value={simParams.raiseSize} onChange={(e)=>setSimParams({...simParams, raiseSize: Math.max(0.1, Number(e.target.value))})} className="w-20 p-1 border rounded"/>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Call size</span>
                      <input type="number" min={0.1} step={0.1} value={simParams.callSize} onChange={(e)=>setSimParams({...simParams, callSize: Math.max(0.1, Number(e.target.value))})} className="w-20 p-1 border rounded"/>
                    </div>

                    {/* run button with profile awareness */}
                    <div className="pt-2 flex gap-2">
                      <button 
                        onClick={handleRunSim}
                        disabled={simRunning} 
                        className="px-3 py-2 bg-emerald-600 text-white rounded disabled:bg-gray-400"
                      >
                        {simRunning ? 'Running...' : 'Run Matchup Sim'}
                      </button>
                      <button 
                        onClick={()=>{ setSimResults(null); }} 
                        className="px-3 py-2 bg-gray-200 rounded"
                      >
                        Clear
                      </button>
                    </div>

                      {/*results display with profile context */}
                    {simResults && (
                      <div className="mt-4 p-3 bg-white rounded shadow text-sm">
                        <div className="flex justify-between font-semibold mb-2">
                          <span>Matchup Results</span>
                          <span className="text-xs text-gray-500">
                            {simResults.totalMatchups} matchups
                          </span>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>Hero Fold EV</span>
                            <span className={simResults.actions.Fold.avgEV >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {simResults.actions.Fold.avgEV.toFixed(3)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span>Hero Call EV</span>
                            <span className={simResults.actions.Call.avgEV >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {simResults.actions.Call.avgEV.toFixed(3)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span>Hero Raise EV</span>
                            <span className={simResults.actions.Raise.avgEV >= 0 ? 'text-green-600' : 'text-red-600'}>
                              {simResults.actions.Raise.avgEV.toFixed(3)}
                            </span>
                          </div>
                        </div>
                        
                        {/* Best action indicator */}
                        <div className="mt-2 pt-2 border-t text-center">
                          <span className="text-xs text-gray-600">Best Action: </span>
                          <span className="font-semibold text-emerald-700">
                            {getBestAction(simResults.actions)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                // New ProfileManager content
                <>
                  <h3 className="text-lg font-semibold mb-4 text-gray-700">Profile Management</h3>
                  <ProfileManager 
                    onProfileChange={setCurrentProfile}
                    currentProfile={currentProfile}
                    baselineGTO={baselineGTO}
                  />
                </>
              )}
            </div>

            {/* Column 2: Poker Chart */}
            <div className="bg-gray-50 p-6 rounded-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                <h3 className="text-lg font-semibold text-gray-700">
                  {showExploitation ? 'Adjusted Strategy' : 'Baseline GTO'}
                </h3>
                <div className="bg-black/80 text-white text-xs px-3 py-1 rounded-full">
                  Analyzing: <span className="font-semibold">{nowAnalyzing || '—'}</span>
                </div>
              </div>

              <div className="flex justify-center mb-4">
                <div className="inline-block bg-gray-200 p-4 rounded-lg">
                  <div
                    className="gap-1"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(13, 1fr)',
                      gridTemplateRows: 'repeat(13, 1fr)',
                    }}
                  >
                    {ranks.map((rank1, i) =>
                      ranks.map((rank2, j) => {
                        const handKey = i === j ? rank1 + rank2 : i < j ? rank1 + rank2 + 's' : rank2 + rank1 + 'o';
                        const isSelected = selectedHand === handKey;
                        const isLive = nowAnalyzing === handKey;

                        return (
                          <div
                            key={`${i}-${j}`}
                            className={`
                              w-8 h-8 flex items-center justify-center text-xs font-bold cursor-pointer
                              transition-all duration-200 hover:scale-110 hover:z-10 relative rounded-sm
                              ${getActionColor(handKey)} ${getTextColor(handKey)}
                              ${isSelected ? 'ring-2 ring-yellow-400 ring-offset-1 z-20' : ''}
                              ${isLive ? 'shadow-[0_0_0_2px_rgba(16,185,129,0.8)] scale-105' : ''}
                            `}
                            style={{ gridColumn: j + 1, gridRow: i + 1 }}
                            onClick={() => setSelectedHand(handKey)}
                            title={`${handKey} - Click for details`}
                          >
                            {isLive && (
                              <span className="absolute inset-0 rounded-sm animate-ping bg-emerald-400/50" />
                            )}
                            <span className="text-[9px] leading-none relative font-bold">
                              {i === j ? rank1 + rank2 : i < j ? rank1 + rank2 : rank2 + rank1}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* Chart description */}
              <div className="text-xs text-gray-600 text-center mb-4">
                Pairs (diagonal) • Suited (upper right) • Offsuit (lower left)
              </div>

              {/* Legend */}
              <div className="flex justify-center flex-wrap gap-3 text-xs">
                <LegendSwatch className="bg-red-500" label="Strong Raise" />
                <LegendSwatch className="bg-red-300" label="Moderate Raise" />
                <LegendSwatch className="bg-blue-500" label="Strong Call" />
                <LegendSwatch className="bg-blue-300" label="Moderate Call" />
                <LegendSwatch className="bg-gray-300" label="Fold" />
                <LegendSwatch className="bg-emerald-400" label="Analyzing" dot />
              </div>
            </div>

            {/* Column 3: Strategy Details + Feed */}
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 text-gray-700">
                {selectedHand ? `${selectedHand} Strategy` : 'Select a Hand'}
                {currentProfile && currentProfile.id !== 'baseline' && (
                  <div className="text-center mb-2">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      Using Profile: {currentProfile.name}
                      {currentProfile.metadata && (
                        <span className="ml-2 opacity-75">
                          ({currentProfile.metadata.handsAnalyzed} hands)
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </h3>
              
              {selectedHand ? (
                <div className="space-y-4">
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={getStrategyData()}>
                        <XAxis dataKey="action" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip formatter={(value) => `${value}%`} />
                        <Bar dataKey="baseline" fill="#94a3b8" name="GTO Baseline" />
                        <Bar dataKey="adjusted" fill="#3b82f6" name="Adjusted" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {showExploitation && opponentStats.handsPlayed > 2 && (
                    <div className="p-4 bg-blue-50 rounded-lg text-sm space-y-2">
                      <p className="font-semibold text-blue-800">Exploitation Analysis:</p>
                      <p className="text-blue-700">
                        {opponentStats.observed3BetFold < 50
                          ? `Opponent only folding ${Math.round(opponentStats.observed3BetFold)}% vs 3-bets (should be 65%). Tightening range significantly.`
                          : opponentStats.observed3BetFold > 75
                          ? `Opponent folding ${Math.round(opponentStats.observed3BetFold)}% vs 3-bets (should be 65%). Widening range with more bluffs.`
                          : 'Opponent folding at near-optimal frequency. Minor adjustments made.'}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">
                          Deviation: {Math.round(Math.abs(opponentStats.foldTo3Bet - opponentStats.observed3BetFold))}%
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs font-semibold ${
                            Math.abs(opponentStats.foldTo3Bet - opponentStats.observed3BetFold) > 20
                              ? 'bg-red-200 text-red-800'
                              : 'bg-yellow-200 text-yellow-800'
                          }`}
                        >
                          {Math.abs(opponentStats.foldTo3Bet - opponentStats.observed3BetFold) > 20
                            ? 'MAJOR EXPLOIT'
                            : 'MINOR EXPLOIT'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">
                  Click on a hand in the chart above to see detailed strategy breakdown
                </p>
              )}

              {/* Realtime feed */}
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">Live Analysis Feed</h4>
                  <span className="text-xs text-gray-500">last {FEED_LIMIT}</span>
                </div>
                <div className="bg-white rounded-lg border max-h-64 overflow-auto">
                  {feed.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500 text-center">
                      Waiting for analysis...
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {feed.map((f, idx) => (
                        <div key={idx} className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="inline-flex w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="font-mono font-bold text-sm">{f.hand}</span>
                            <span className="text-xs text-gray-500">{f.time}</span>
                          </div>
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              f.action === 'Raise'
                                ? 'bg-red-100 text-red-800'
                                : f.action === 'Call'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                            title={`Baseline ${f.baseline}% / Adjusted ${f.adjusted}%`}
                          >
                            {f.action}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-gray-50 border-t border-gray-200">
          <p className="text-sm text-gray-600 text-center max-w-4xl mx-auto">
            This demo shows dynamic GTO adjustments based on opponent tendencies, and a testing mode
            that Monte Carlo simulates preflop showdown equities to estimate EV of actions against a profile.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PokerChart;

// Helper functions
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


function makeFeedItem(hand, adjusted, baseline) {
  const stratAdj = adjusted[hand] || { fold: 100, call: 0, raise: 0 };
  const stratBase = baseline[hand] || { fold: 100, call: 0, raise: 0 };
  const action = pickTopAction(stratAdj);
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return {
    hand,
    action,
    baseline: stratBase[action.toLowerCase()],
    adjusted: stratAdj[action.toLowerCase()],
    time,
  };
}

function pickTopAction({ fold, call, raise }) {
  const entries = [
    { k: 'Fold', v: fold },
    { k: 'Call', v: call },
    { k: 'Raise', v: raise },
  ];
  entries.sort((a, b) => b.v - a.v);
  return entries[0].k;
}

function LegendSwatch({ className = '', label, dot = false }) {
  return (
    <div className="flex items-center gap-1.5">
      {dot ? (
        <span className={`w-3 h-3 rounded-full ${className}`} />
      ) : (
        <span className={`w-3 h-3 rounded ${className}`} />
      )}
      <span className="text-xs">{label}</span>
    </div>
  );
}
function getProfileSummary(profileId, profiles, adjustedStrategy, baselineGTO) {
  if (profileId === 'baseline') {
    return (
      <div className="mt-1 text-xs text-gray-500">
        Standard GTO baseline
      </div>
    );
  } else if (profileId === 'current') {
    return (
      <div className="mt-1 text-xs text-gray-500">
        Live adjusted strategy
      </div>
    );
  } else if (profiles && profiles[profileId]) {
    const p = profiles[profileId];
    return (
      <div className="mt-1 text-xs text-gray-500">
        VPIP: {p.stats.vpip?.toFixed(1) || 'N/A'}% • 
        3-bet fold: {p.stats.foldTo3Bet?.toFixed(1) || 'N/A'}%
      </div>
    );
  }
  return null;
}

function getProfileDisplayName(profileId, profiles) {
  if (profileId === 'baseline') return 'GTO Baseline';
  if (profileId === 'current') return 'Live Adjusted';
  return profiles && profiles[profileId] ? profiles[profileId].name : 'Unknown';
}

function getProfileStrategy(profileId, profiles, adjustedStrategy, baselineGTO) {
  if (profileId === 'baseline') return baselineGTO;
  if (profileId === 'current') return adjustedStrategy;
  return profiles && profiles[profileId] ? profiles[profileId].strategy : baselineGTO;
}

function getBestAction(actions) {
  const entries = Object.entries(actions);
  const best = entries.reduce((max, [action, data]) => 
    data.avgEV > max.ev ? { action, ev: data.avgEV } : max
  , { action: 'Fold', ev: -Infinity });
  
  return best.action;
}

