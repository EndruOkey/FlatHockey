# FlatHockey -- Readability Layer v1

Goal: Players should recognize **within \<0.5 s**: - where *they* are -
who is on *their team* - who has the *puck*

The system keeps UI minimal while preserving clarity in chaotic pond
matches.

------------------------------------------------------------------------

# 1. Player Indicator (Own Player)

A **subtle circle under the player**.

Design:

O \[ \] /\
( )

Parameters:

-   radius ≈ 110--115 % player width
-   thickness ≈ 2 px
-   opacity ≈ 20--25 %
-   color = team color

Behavior:

-   always visible
-   subtle
-   no glow

------------------------------------------------------------------------

# 2. Enhanced Indicator (Player With Puck)

When the player has the puck, the circle becomes slightly stronger.

Parameters:

-   radius ≈ 115--120 %
-   opacity ≈ 35--40 %
-   thickness ≈ 3 px

No pulsing animation --- just a small visual boost.

------------------------------------------------------------------------

# 3. Team Identity

Teams are readable through two elements:

## A -- Jersey

Primary visual identity.

## B -- Player Name

Nicknames are lightly tinted with team color.

Example:

-   blue team → light blue text
-   red team → light red text
-   yellow team → light yellow text

Opacity ≈ 85--90 %

------------------------------------------------------------------------

# 4. Nick Highlight (Player With Puck)

When a player controls the puck:

-   font weight = bold
-   opacity = 100 %

------------------------------------------------------------------------

# 5. Puck Ownership Hint

Stick highlight method.

When controlling the puck:

-   stick brightness +10--15 %

No glow effects.

Puck has a subtle rim highlight:

-   rim width ≈ 1 px
-   color = ice white

------------------------------------------------------------------------

# 6. Puck Trail

Trail helps readability at speed.

Structure:

3 ghost frames

Opacity:

-   100 %
-   60 %
-   25 %

Duration:

≈ 0.2 s

------------------------------------------------------------------------

# 7. Collision Feedback

When players collide:

-   micro screen shake
-   small ice spray

Purpose: improve clarity of physical interactions.

------------------------------------------------------------------------

# 8. Camera Micro-Follow

Camera bias toward puck.

Parameter:

-   puck influence ≈ 20 %

Camera still follows the player but reacts slightly to puck movement.

------------------------------------------------------------------------

# 9. UI Minimalism Rule

Maximum gameplay UI:

-   player name
-   player circle indicator
-   score

Everything else should remain in-world.

------------------------------------------------------------------------

# 10. Readability Tests

The system must pass three tests.

## Chaos Test

20 players on pond → puck and teams remain readable.

## Peripheral Vision Test

Player focuses on puck but still sees own character.

## Grayscale Test

Game remains readable without color.
