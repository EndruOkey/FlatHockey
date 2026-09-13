# FlatHockey — Puck & Stick Core Spec (v1)

---

## 1. Stick Zones (by mouse distance)

CLOSE  
MID  
EXTENDED  

### Effects

| Zone      | Control | Stability | Catch | Poke |
|-----------|--------|----------|------|------|
| CLOSE     | max    | high     | high | high |
| MID       | good   | medium   | medium | medium |
| EXTENDED  | low    | low      | low  | low |

---

## 2. Puck States

FREE  
CONTROLLED  
UNSTABLE  
RELEASE  

---

## 3. Ownership Model

- puck attaches to **blade (stick), not player**
- attach = soft snap (not teleport)
- visual forehand/backhand handled separately (no gameplay impact)

---

## 4. Pickup

### Conditions:
- puck in **pickup zone (blade area)**
- small assist magnet in wider radius

### Behavior:
- short snap → CONTROLLED
- not instant, but fast

---

## 5. Control Stability

### CONTROLLED:
- stable carry
- full control

### UNSTABLE:
- temporary instability
- higher loss probability

---

## 6. Stability Triggers

### Gain UNSTABLE when:

- fast stick rotation change (Δangle)
- fast direction change while puck offset
- EXTENDED zone + movement
- incoming contact (poke / crosscheck)
- during CHARGE

---

### Lose puck (→ FREE) when:

- UNSTABLE + additional trigger
- strong contact (crosscheck / poke)
- high mismatch (movement vs stick)

---

### Recovery:

- UNSTABLE → CONTROLLED over time
- slower during movement / charge

---

## 7. Passive Poke

- always active (no input)
- depends on stick zone

### Rules:
- gated (no spam)
- strongest in CLOSE
- weakest in EXTENDED

---

## 8. Catch (incoming puck)

### Conditions:
- puck intersects blade area

### Result:

| Zone      | Result        |
|-----------|-------------|
| CLOSE     | CONTROLLED  |
| MID       | CONTROLLED / UNSTABLE |
| EXTENDED  | UNSTABLE / deflect |

### Body = 100% stop (no miss)

---

## 9. Crosscheck (RMB hold)

### Activation:
- hold RMB

### Effects:

- slight speed increase
- reduced steering control

---

### On contact:

CONTROLLED → UNSTABLE  
UNSTABLE → FREE  

---

### Depends on opponent zone:

| Zone      | Result |
|-----------|--------|
| CLOSE     | often holds |
| MID       | contest |
| EXTENDED  | high loss |

---

### Additional:
- small positional push
- contact-gated (no spam stacking)

---

## 10. Release System

---

### Direction:
- always toward **mouse**
- pass slightly assists toward teammate (with light prediction)

---

## PASS

CONTROLLED → RELEASE → FREE  

- instant
- medium impulse
- no charge

---

## CHARGE

### Activation:
- hold shoot input

---

### Effects:

- stick extends (visual + gameplay bias)
- **steering locked (no turning)**
- speed decays over time
- unstable gain ↑
- recovery ↓

---

### Cancel:
- RMB (crosscheck)
- puck loss

---

## RELEASE (charged)

CONTROLLED → CHARGE → RELEASE → FREE  

- strong impulse
- direction = mouse

---

## ONE-TIMER

INCOMING + CHARGE → RELEASE → FREE  

- requires pre-charge (stick prepared)
- no charge → no one-timer

---

## 11. Charge Break (auto cancel)

CHARGE → (puck lost) → CHARGE_BREAK → NORMAL  

---

### CHARGE_BREAK:

- short blend-out state
- no instant snap

---

### During break:

- stick returns to neutral
- steering gradually restored
- speed decay stops
- control restored progressively

---

## 12. Anti-Glitch Rules

- all contact effects are **gated**
- no per-tick stacking
- stick = single source of puck interaction
- no instant snap transitions (always short blend)

---

## 13. Core Principles

- stick-driven, not player-driven
- readable outcomes
- risk = exposure (not randomness)
- no hidden assists except minimal pass help
- all strong actions (charge, extended) increase vulnerability

---

# END