# Areas 2 to 8: content plan

Draft for Boss to review (30 Oct 2026). This is a plan only: nothing here is built yet, and no game code changes with it.

It starts from Boss's plan table (project chat, 30 Oct 2026), whose Areas 2 to 8 Locations and NPCs columns repeated the Home Town list as placeholders. Everything else comes from the Systems Specification v1 (the "Spec" below), `public/data/*.json` on `test/v1.5`, and `alpha-v1.1/area1-whats-missing.md`.

Names marked *(placeholder)* are mine, to be replaced by Boss. Anything marked **Decision** is listed again in [Open decisions](#open-decisions-for-boss).

## What Boss has set

- **Five NPCs in every area:** Lee Stocky (Lee's T's & Wheels) joined the four below (Boss, 30 Oct 2026).
- **The original four:** Paul Phoenix (Phoenix MX), Bill Rothon (Moto78), Jedrick Nicholls (Nicholls Used Motors) and Manny Festo. They offer better parts as the game goes on, and their shops may grow. Phoenix MX will sell clothing as well as fixing bikes.
- **Joseph Halden at every track venue.** This is already in on `test/v1.5` (he runs the race office at every track), so each new venue just places him.
- **Dan Smyth** stays an Area 1 NPC (the Industrial Zone challenger).
- **Every area from 2 to 8** gets parts making (batch jobs) and at least one new fitness activity.
- **Energy drinks from Area 4 to 8.** Where they're sold isn't decided.
- **Area 5** has a storyline that unlocks and introduces the Modifying Machine.
- **Story beats from the table:** Area 3 is Big Pete, the Rider Trainer who trained all the top riders (he also unlocks whips and scrubs, per PR 46). Area 4 is Energy Drinks. Area 5 is Sponsored Rides. Every area has shop tasks and new Local and Area Champions.
- **Track types:** Enduro Sprint opens in Area 5, No-Turn Takedown in Area 7 and EnduroCross in Area 8.
- **Area Champions:** Area 2 Taylor Heart, Area 3 Aidan Gizard, Area 4 Kate Gizard, Area 5 Louie Gizard, Area 6 James Nestor, Area 7 Harvey Gizard, Area 8 Neal Gizard.
- **Vehicles:** Area 2 Old Rusty Van, then Motor 3 to Motor 6 in Areas 3 to 6. The Factory Hauler (Motor 7) is never driven by the player (Boss, 31 Oct 2026): see [Motors](#motors).
- **Houses:** every town from Area 2 has a house to buy, and prices go up every area (Boss, 30 Oct 2026). There is one shared storage box, reached from every house the player owns, from the rented room to the end-game house. It gets bigger with each house bought, so there's no carrying things back and forth (Boss, 30 Oct 2026).

## The goal: nothing left without a source

By the end of Area 8, every one of the 19 child skills should have at least one activity that trains it, and every one of the 10 bike part slots should be both **buyable** and **earned as the kept part from a batch job**. Every part group should also have a **tool set** to buy, so the player can repair it themselves. The tables in the next three sections check all three.

### Every skill has something to train on

Today only racing (all Rider Ability skills), bodyweight drills (Strength), running (Endurance) and walking (Agility) give XP. Shifts pay money but no Mechanical Engineer XP. That needs fixing in Area 1 before Area 2 (see [Gaps](#gaps-found)).

| Lead | Skill | Today | Planned activity (area it opens) |
|---|---|---|---|
| Rider Ability | Balance | Racing | Rut riding (A2), Whoops and sand (A3), Rock garden (A5) |
| | Riding Position | Racing | Body position drills (A2) |
| | Cornering and Braking | Racing | Cone braking (A2), Berm and flat corner (A4) |
| | Jumps and Ruts | Racing | Jump timing and tricks with Big Pete (A3), Supercross rhythm (A7) |
| | Starts | Racing | Gate drop (A3), Drag launch (A7) |
| | Overtaking | Racing | Shadow passing (A5) |
| | Consistency | Racing | Repetition laps (A6) |
| Mechanical Engineer | Bodywork | Nothing | Fabrication shift (A1 fix), Plastics moulding (A6), Bodywork fitting at home |
| | Wheels | Nothing | Tyre change at Moto78 (A1 fix), Wheel works (A2), Brake works (A3) |
| | Suspension | Nothing | Suspension shop (A4) |
| | Engine Components | Nothing | Engine shift (A1 fix), Gearbox works (A6), Exhaust and intake works (A7) |
| | Engine Assembly | Nothing | Engine build at the engine rebuilder (A1 fix), Gearbox works (A6) |
| | Welding | Nothing | Fabrication shift (A1 fix), Frame works (A5), Exhaust and intake works (A7) |
| | Machining | Nothing | Engine shift (A1 fix), Brake works (A3), Gearbox works (A6) |
| | Customer repairs (mixed) | Nothing | Phoenix MX job board, every area (A1 fix) |
| Fitness | Agility | Walking | Agility ladder (A3) |
| | Strength | Bodyweight drills | Weight training at the gym (A2) |
| | Endurance | Running | Rowing (A5), Cycling (A6) |
| | Martial Arts | Nothing | Dojo (A7) |
| | Wellbeing | Nothing | Yoga (A4), Ice bath at the recovery centre (A8) |

Each new area also raises the facility tier of earlier activities (Spec 2.2), so older training spots don't go stale: Tier 1 in Area 1, Tier 2 from Area 2, Tier 3 from Area 4, Tier 4 from Area 6, and Tier 5 in Area 8.

### Every bike part can be bought or earned

Kept part: the employer gives one random part from each finished batch (Spec 15.1). **No making parts above your current class** (Boss, 30 Oct 2026, replacing Spec 15.5's "a player can make parts for a class they have not reached yet"). A batch is always for a class the player has already unlocked, so every kept part can be fitted.

| Slot | Buy it at | Batch job that can give it as the kept part |
|---|---|---|
| Frame | Moto78: a stock Grade 1 frame of your brand, for every class you've unlocked (see below) | Frame works (A5), Race department (A8) |
| Top end | Phoenix MX | Engine rebuilder (A1) |
| Bottom end | Phoenix MX | Gearbox works (A6) |
| Intake and exhaust | Phoenix MX | Exhaust and intake works (A7) |
| Drivetrain | Phoenix MX | Gearbox works (A6) |
| Forks | Phoenix MX | Suspension shop (A4) |
| Shock | Phoenix MX | Suspension shop (A4) |
| Wheels and tyres | Lee's T's & Wheels | Wheel works (A2) |
| Brakes | Lee's T's & Wheels | Brake works (A3) |
| Bodywork and controls | Moto78 | Fabrication shop (A1), Plastics moulding (A6) |

The Race department in Area 8 takes contracts for any slot, at higher pay (Spec 15.2: Mechanical Engineer 70 plus an NPC chain).

### Every tool set can be bought, and gets better each area

Tools let the player repair and fit parts themselves instead of paying Phoenix MX (Spec 17.2a), and they take up tool slots in the house and motor (Spec 17.1, 17.3). Today the Area 1 tool shop counter does nothing.

There are four tool sets, one per part group. Each set gets its first version in the area its parts start being made, then a better version later. The better version repairs higher grades, so the tools keep pace with the parts. Three versions of each set, with these grade limits (Boss, 30 Oct 2026).

| Tool set | Covers slots | First version (area, price) | Repairs up to | Better versions |
|---|---|---|---|---|
| Bodywork tools | Bodywork and controls, Frame | A1, £300 | Grade 3 | Pro in A4 (Grade 6), Master in A7 (Grade 9) |
| Wheel and brake tools | Wheels and tyres (fitting only, as tyres are only replaced), Brakes | A2, £600 | Grade 4 | Pro in A5 (Grade 6), Master in A8 (Grade 9) |
| Engine tools | Top end, Bottom end, Intake and exhaust, Drivetrain | A3, £3,000 | Grade 5 | Pro in A6 (Grade 7), Master in A8 (Grade 9) |
| Suspension tools | Forks, Shock | A4, £1,500 | Grade 5 | Pro in A6 (Grade 7), Master in A8 (Grade 9) |

Tools don't wear out: a set is bought once and lasts for good, like the motors (Spec 17.3 says vehicles never need maintenance, and the Spec gives tools no condition). Grade 10 parts always go to Phoenix MX. Pro and Master prices follow the 10% to 20% of the matching house tier rule (Spec 17.2a), so Pro sets cost £1,200 to £2,400 and Master sets £8,000 to £16,000 (provisional).

Tools also open some work:

- **Bodywork fitting at home** (Bodywork) needs bodywork tools.
- **Tyre change** away from Moto78 needs wheel and brake tools.
- **Customer repair tickets** on the Phoenix MX job board ask for the tool set for that ticket's slot, so better tools open better-paying tickets.
- **House workshop upgrades** (engine stand, suspension tools, tyre machine, Spec 17.1) are separate from the tool sets. They're bought for the house, not carried.

**Where tools are sold.** The Area 1 tool shop is the only tool shop (Boss, 30 Oct 2026).

**Jason Styles owns the tool shop, now called J's Tools** (Boss, 30 Oct 2026). He's the same Jason Styles who races in the Area 1 pool.

- **Back story:** he moved to Home Town from South Africa chasing the dream. He's raced all his life but never made the big leagues, and he's hoping this season is the one.
- **Look:** 40s, white, ginger hair and ginger freckles, black jeans, and a white T-shirt with the shop logo on it.
- **Art to update:** a sprite for him, the new J's Tools logo on his shirt, and the building name and sign, and a South African flag on a wall inside the shop (Boss, 30 Oct 2026). It adds each new set as the area that brings it opens, so the "Tool shop" lines in each area below mean what the Area 1 shop starts stocking then. A second tool shop in Area 5 might come later, but that isn't settled.

### When a frame breaks

Frames wear (1,000 km at full condition), and a big crash or random breakage can break one. Today that's a dead end for a new player: the 50cc frame is Grade 1, so it can't be repaired (Spec 7.4), a broken part can only be dumped (Spec 7.2), and no shop sells frames. The bike would be stuck at 10% of its frame stats for good.

Agreed fix (Boss, 30 Oct 2026): **Moto78 sells a stock Grade 1 frame of your bike's brand** for every class you've unlocked, at the normal price (£400 for a 50cc). A sponsored rider gets a broken frame replaced free by their sponsor. Better frames still come only from sponsors, the Frame works (A5) and the Race department (A8). This needs adding to Area 1 now, as it can already happen in the current build.

## The travelling NPCs

They each have a shop or stand in every area, in a building that looks the same everywhere (the facility blueprint idea from Spec 18.0), so players recognise them at once.

| NPC | Every area | Grows as the game goes on |
|---|---|---|
| **Paul Phoenix**, Phoenix MX | Repairs (one grade down, Grade 2 and up), bench fitting, customer repair job board, and engine and suspension parts (top end, bottom end, intake and exhaust, drivetrain, forks, shock; Boss, 30 Oct 2026) | Clothing from Area 2: a small rack on the garage side of the same-size shop, with nothing buyable until the Area 2 house is bought, which unlocks the wardrobe (Boss, 30 Oct 2026), bigger workshop, reputation hints about sponsors (Spec 16.0) |
| **Bill Rothon**, Moto78 | Bodywork and controls, stock frames, and the tyre changer: tyres fitted there, and tyre change training (Boss, 30 Oct 2026) | Grade range and classes rise each area (table below). Class dealer: winning a class's championship comes with a sponsorship offer that brings the new class frame; a rider who turns it down buys the new class frame from Bill instead (Boss, 30 Oct 2026) |
| **Jedrick Nicholls**, Nicholls Used Motors | The motor for that area | Sells the next motor each area (Old Rusty Van in A2 to Motor 6 in A6), then the late-game sports car |
| **Manny Festo**, the news man | News about the next championship, the new Area Champion, and rumours that point to hidden venues and storylines | He stays the news man in every area, with no stall (Boss, 30 Oct 2026), and starts each area's story |

**Lee Stocky**, Lee's T's & Wheels, is the **fifth travelling NPC** (Boss, 30 Oct 2026). He runs the tyres and wheels shop in every area, selling wheels and tyres and brakes.

- **Back story:** he won the Area Championship a few seasons back, then was out injured. He's getting back to racing this season, so the player sees him at some of their races.
- **Look:** late 40s, white, bald with a five o'clock shadow, blue jeans, white trainers, and a black T-shirt with the shop logo on it.
- **Art to update:** his sprite (the current tyre specialist, `npc-04-tyre-specialist`), the logo on his shirt, and the shop's building name and sign, which become "Lee's T's & Wheels". His name replaces "Tyres and wheels specialist" in `npcs.json` and the shop name in `shops.json`.
- **Racing:** he's the same Lee Stocky who's in the rider list (Boss, 30 Oct 2026). He's level 2 in the Area 1 pool today, so his level wants raising to fit a former Area Champion coming back from injury, and he should be in the pool of every area.

### Shop stock by area (proposed)

Area 1 is agreed (Grades 1 to 3, 50cc and 65cc). The grades apply to Phoenix MX, Moto78 and Lee's T's & Wheels alike. Each later area adds a grade at the top and the next class, and keeps earlier classes. Grades 9 and 10 never appear in shops: only batch jobs, the Race department and set NPC rewards give them (Spec 14.4).

| Area | Grades on the shelf | Classes stocked (adds) | Badge challenge class (Spec 18.1) |
|---|---|---|---|
| 1 | 1 to 3 | 50cc, 65cc | 50cc |
| 2 | 1 to 4 | 85cc SW | 65cc |
| 3 | 2 to 5 | 85cc BW | 85cc SW |
| 4 | 2 to 5 | 125cc Youth | 85cc BW |
| 5 | 3 to 6 | 125cc | 125cc Youth |
| 6 | 3 to 7 | 250cc F | 125cc |
| 7 | 4 to 7 | 450cc F, Vets | 250cc F |
| 8 | 4 to 8 | All | 450cc F |

## Area by area

Area names are locked in by Boss (30 Oct 2026): 2 Mountain Town, 3 Beach Town, 4 Forest Town, 5 Northern Works, 6 Highlands, 7 The City, 8 Capital. The City and Northern Works swap places from Spec 18.1, so their themes, venues and jobs swap too, while the story beats stay with the area number. Track and NPC names are placeholders unless Boss gave them.

Every area has the same base set, so the columns below list only what's **new**:

- Phoenix MX, Moto78, Nicholls Used Motors, Lee's T's & Wheels, and Manny Festo.
- A Motocross venue, a Supercross venue and an Enduro Loop venue, each with Joseph Halden at the race office.
- Two challengers, each with their own challenge track. Each challenger gives the player a short task first, and the challenge opens once it's done (Boss, 31 Oct 2026).
- A Local Champion championship (one round per area venue) for the badge, then the main area championship (two rounds per venue, and from Area 2 it can include earlier areas' tracks).
- A route marshal at the exit, and a Road menu entry under Areas.
- Shop tasks: errands like the scrapyard owner's (lend a worn part to repair), deliveries between the area's shops. No hidden venues: the challengers' tracks fill that role (Boss, 31 Oct 2026).

### Arriving in a new area: the area intro (Boss, 31 Oct 2026)

Every area from 2 to 8 opens with a short intro chain, like the tutorial. **The area's tracks stay locked until it's done.** It always ends with the player meeting the area's **Local Champion**, who points them to the tracks that are now open. It runs on the same story steps and tutorial markers as the Area 1 opening chain (`story.json`).

**The same six steps in every area:**

1. **Arrive.** Manny Festo meets the player at the road in with the area's news: who the champions are, and what's new in town.
2. **The shops.** A step at one of the travelling NPCs' shops, showing what's new there this area (better grades, a new class, or a new service).
3. **An errand.** A delivery between two of the area's shops, like the parts order in the tutorial, so the player learns the town's layout.
4. **The new job.** One short run at the area's new batch facility, where the boss explains the kept part.
5. **The new training.** One round of the area's new fitness activity, and the rider drill if the area has one.
6. **Meet the Local Champion.** They're waiting by the race office or their own hang-out. They talk up their tracks, unlock them, and the markers lead the player there.

The area's own story beat (the house, Big Pete, Maggie's quest and so on) starts once the intro is done, so the intro stays short.

**Placeholder Local Champions** (names and looks to replace; Boss will rename pool riders into these spots later):

| Area | Local Champion *(placeholder)* | Character | Step 2 shop | Step 4 job | Step 5 training |
|---|---|---|---|---|---|
| 2 Mountain Town | Cal Mercer | A mud specialist who knows every line on the mountain tracks | Phoenix MX's new clothing rack (locked until the house is bought) | Wheel works | Weight training at the gym, then body position drills |
| 3 Beach Town | Sandy Tate | A sand rider who grew up on the dunes, and an old pupil of Big Pete | Lee's T's & Wheels: sand tyres | Brake works | Agility ladder on the beach, then gate drop |
| 4 Forest Town | Rowan Ash | Quiet, rides the woods every day, hates being passed | Moto78: the 125cc Youth class arrives | Suspension shop | Yoga |
| 5 Northern Works | Dex Hollis | A former works mechanic who rides like one | Phoenix MX: engine parts at Grade 6 | Frame works | Rowing on the canal, then rock garden |
| 6 Highlands | Fergus Bain | A hill climber who loves long races | Nicholls Used Motors: Motor 6 | Gearbox works | Cycling, then repetition laps |
| 7 The City | Nina Vance | A supercross star who rarely rides outdoors | Moto78: the 450cc F and Vets classes | Exhaust and intake works | Martial arts dojo, then supercross rhythm |
| 8 Capital | Marcus Stone | A former national champion and the toughest Local Champion | All four travelling shops at their top grades | Race department (shown, opens at Mechanical Engineer 70) | Recovery centre ice bath |

### Area 2: Mountain Town (mountain valley, clay, rain and mud)

- **Art:** new tiles for a **mountain backdrop** behind the town and its venues (Boss, 30 Oct 2026).

- **Story:** shop tasks and the new Local and Area Champions (Area Champion Taylor Heart). The rain arrives.
- **Batch job:** **Wheel works** (wheels and tyres). Minigame: wheel building (Wheels). Pay £1 a part, batch 50.
- **Fitness:** **Town gym, weight training** (Strength, Tier 2). The Spec already puts the gym in Area 2, unlocked by a gym NPC task.
- **Rider training:** practice track coach *(placeholder name)* with body position drills (Riding Position) and cone braking (Cornering and Braking). Rut riding in the mud (Balance, Jumps and Ruts).
- **Venues:** a clay outdoor MX track and a mud bog Enduro Loop *(placeholders)*; a supercross venue *(placeholder)*.
- **New at the Area 1 tool shop:** wheel and brake tools (£600).
- **House:** Starter terrace (£3,000), with the shed workshop interior that's already drawn. Buying it **unlocks the wardrobe**, and with it clothing (Boss, 30 Oct 2026).
- **Clothing:** Phoenix MX, same size shop, gets a small clothing rack on the garage side. The rack is there from Area 2, but nothing on it can be bought until the Starter terrace is bought.
- **Motor:** Old Rusty Van.

### Area 3: Beach Town (dunes and sand)

- **Story:** **Big Pete, the Rider Trainer.** He trained all the top riders, and finishing his chain unlocks whips (from Rider Ability 30) and scrubs (from 60) for the player. Area Champion Aidan Gizard.
- **Batch job:** **Brake works** (brakes). Minigame: machining (Machining, Wheels). Pay £1 a part, batch 50.
- **Fitness:** **Agility ladder** on the beach (Agility). Agility only comes from walking today.
- **Rider training (Big Pete):** jump timing and tricks (Jumps and Ruts), gate drop (Starts), whoops and sand on the sand track (Balance, Jumps and Ruts).
- **Venues:** sand MX track, beach endurance loop, a supercross venue *(placeholders)*.
- **New at the Area 1 tool shop:** engine tools (£3,000).
- **House:** Semi with garage (£12,000).
- **Motor:** Motor 3, MX Van Short.

### Area 4: Forest Town (roots, loam, wet woods)

- **Story:** **Energy drinks** arrive. A short task introduces them (for example, a drinks rep needs help at the race office), then they're on sale for Areas 4 to 8. Area Champion Kate Gizard.
- **Batch job:** **Suspension shop** (forks and shock). Minigame: suspension service (Suspension). Pay £1.50 a part, batch 100.
- **Fitness:** **Yoga** at a woodland retreat (Wellbeing). Wellbeing has nothing to train on today.
- **Rider training:** berm and flat corner (Cornering and Braking), rut riding over roots (Balance).
- **Venues:** woodland MX, forest enduro loop, a supercross venue *(placeholders)*.
- **New at the Area 1 tool shop:** suspension tools (£1,500) and Pro bodywork tools.
- **House:** a reskin of the Area 3 Semi with garage (Boss, 30 Oct 2026). House prices still go up every area, so it costs more than Area 3's: £30,000 (Boss, 30 Oct 2026). It's for convenience, a home in town that reaches the shared storage.
- **Energy drinks:** see [Energy drinks](#energy-drinks-areas-4-to-8).
- **Motor:** Motor 4, MX Van Medium.

### Area 5: Northern Works (quarry, old industry, rock and dust)

- **Story:** **the Modifying Machine** quest starts here (below), and **Sponsored Rides**. Sponsor offers open after the Local Champion championship (Spec 16), and the first sponsor brings a branded frame and an outfit. Area Champion Louie Gizard.
- **Batch job:** **Frame works** (frames). Minigame: welding (Welding). This is the only way to get a better frame without a sponsor. Pay about £2 a part, batch 100, double the usual, since frames are worth about 10 times a top end (Boss, 30 Oct 2026).
- **Fitness:** **Rowing** on the old canal (Endurance).
- **Rider training:** rock garden (Balance), shadow passing with a local pro (Overtaking).
- **New at the Area 1 tool shop:** Pro wheel and brake tools.
- **Venues:** quarry MX, rock endurance loop, a supercross venue, and the **first Enduro Sprint** *(placeholders)*.
- **House:** Detached house (£80,000).
- **Motor:** Motor 5, MX Sports Motorhome Medium.

#### The Modifying Machine storyline (Area 5)

The machine stays in the Industrial Zone unit in Area 1, where it's already built, and it's broken until this quest line fixes it (Boss, 30 Oct 2026).

**How other characters talk about her** (Boss, 30 Oct 2026): "Mad Maggie" is her name on screen, but other characters call her Maggie the scientist, the scientist Maggie and so on, along the lines of "Go and see Maggie the scientist. She's a bit eccentric, if you know what I mean." Mix the wording up between characters where we can. She's never the butt of the joke.

1. **The start.** When Area 5 opens, Manny Festo's news mentions **Mad Maggie**, the modifier machine owner (Boss, 30 Oct 2026: a brilliant, eccentric mad-scientist tinkerer, keeping her current look of lab coat, goggles pushed up and messy grey hair), whose machine in the Industrial Zone has been broken for years. In Northern Works the player meets someone who knows her and sends the player to help.
2. **Back through the past areas.** The tasks take the player back through Areas 1 to 4, tracking down what the machine needs. Along the way the player gets **two parts** for the machine's first test. Each is either a worn part they have to repair on the way, or the kept part from a batch they complete.
3. **Fixing the machine.** The quest ends in the Industrial Zone unit with the player fixing the machine themselves. This step needs **Mechanical Engineer 30** (Boss, 30 Oct 2026).
4. **The first test, still part of the quest:**
   - **Part one disappears.** The machine breaks it for good, and Maggie says something like "Whoops, forgot to tell you about that." Then she explains the rules: a 1 in 10 chance of losing the part on every go, no rerolls, and parts must have no modifiers and be at 80% condition or better.
   - **Part two comes out at +1, −1, −1.** Maggie says "Better luck next time, but at least it didn't disappear."
5. **After that**, the quest line ends and the machine is open for good, at the normal rules: a fee of £20 at Grade 1 that doubles each grade, a 1 in 10 break chance, and all three modifiers positive about 1 in 10,000 (Spec 6). There's only one machine in the game, the one in Area 1.

### Area 6: Highlands (hills, moorland, wind, long climbs)

- **Story:** shop tasks and the new champions. Area Champion James Nestor.
- **Batch jobs:** **Gearbox works** (bottom end and drivetrain). Minigames: machining and engine build (Machining, Engine Assembly, Engine Components). Pay £1.25 a part, batch 100. Plus **Plastics moulding** (bodywork and controls). Minigame: bodywork fitting (Bodywork). Pay £1 a part, batch 50.
- **Fitness:** **Cycling** hill climbs (Endurance).
- **Rider training:** repetition laps on the hill track (Consistency).
- **New at the Area 1 tool shop:** Pro engine and Pro suspension tools.
- **Venues:** hill MX, large endurance course, a supercross venue, Enduro Sprint *(placeholders)*.
- **House:** Farmhouse with land (£400,000, needs three badges), with its own private practice track.
- **Motor:** Motor 6, MX Sports Motorhome Long.

### Area 7: The City (stadium and indoor arena)

- **Story:** shop tasks and the new champions. Area Champion Harvey Gizard.
- **Batch job:** **Exhaust and intake works**. Minigames: welding and engine build (Welding, Engine Components). Pay £1.25 a part, batch 50.
- **Fitness:** **Martial arts dojo** (Martial Arts, with some Agility and Strength). The dojo unlocks through a short task, as the Spec says.
- **Rider training:** supercross rhythm in the indoor arena (Jumps and Ruts, Riding Position), drag launch on the No-Turn strip (Starts).
- **New at the Area 1 tool shop:** Master bodywork tools.
- **House:** a reskin of the Area 8 Champion's estate, without the trophy and bike display room (Boss, 30 Oct 2026). £1,000,000, with storage just under the estate's (Boss, 30 Oct 2026).
- **Venues:** supercross stadium, arenacross, outdoor MX on the city edge, Enduro Sprint, and the **first No-Turn Takedown** *(placeholders)*.
- **Motor:** the Factory Hauler arrives with full factory sponsorship, and Nicholls sells the sports car (see [Motors](#motors)).

### Area 8: Capital (national venues, all weather)

- **Story:** shop tasks and the final champions. Area Champion Neal Gizard. Winning Area 8 leads to the Super Event (Spec 19).
- **Batch job:** **Race department** (any slot, £2.50 a part, batch 100). It needs Mechanical Engineer 70 and an NPC chain.
- **Fitness:** **Recovery centre** with an ice bath (Wellbeing), plus Tier 5 versions of every fitness drill.
- **Rider training:** Tier 5 versions of the rider drills.
- **New at the Area 1 tool shop:** Master wheel and brake, engine and suspension tools.
- **Venues:** national MX, national supercross, a national endurance course, Enduro Sprint, No-Turn Takedown, the **first EnduroCross**, and the Super Event venue.
- **House:** Champion's estate (£2,000,000, needs all badges).
- **Motor:** none new.

## Motors

Prices and space (bikes / parts / tool slots), proposed by Claude and agreed by Boss (31 Oct 2026). The old motor goes in part-exchange, and motors never need maintenance.

| Area | Motor | Price | Space |
|---|---|---|---|
| 1 | Old Rusty Truck | £600 | 1 / 20 / 10 |
| 2 | Old Rusty Van | £2,500 | 2 / 40 / 15 |
| 3 | MX Van Short | £6,000 | 2 / 60 / 20 |
| 4 | MX Van Medium | £14,000 | 3 / 90 / 35 |
| 5 | MX Sports Motorhome Medium | £30,000 | 4 / 140 / 50 |
| 6 | MX Sports Motorhome Long | £60,000 | 5 / 200 / 70 |

**The Factory Hauler isn't bought or driven** (Boss, 31 Oct 2026). Once the player has a full factory sponsor in the late game, the team drives it: it's parked at **every venue** as if the team brought it, ready for the player to race out of, with room for 11 bikes (one per class), 400 parts and 120 tools. With the bikes at the track, Jedrick Nicholls sells the player an **expensive sports car** to get about in. It costs **£250,000** and can only be bought once the player has the factory sponsor (Boss, 31 Oct 2026). It needs new vehicle art.

## Energy drinks (Areas 4 to 8)

**Parked** (Boss, 30 Oct 2026): we'll dig deeper into energy drinks closer to Area 4. The notes below are a starting point only.

The rules are already agreed in Spec 4: drinks boost XP for one race day, never race speed. The number of active drinks is limited by Fitness level (1, then 2 at 50, then 3 at 80). Each skill has its own drink.

**Where to sell them (Decision).** My recommendation is a **drinks van parked by the race office at every venue** from Area 4, with Moto78 stocking a few as well:

- Drinks are only used on race day, so selling them at the track is where the player needs them.
- A van can turn up at every venue without a new building in every area. It's one sprite and one stall.
- Moto78 stocking a few covers players who plan ahead.

The other options are its own shop in each town, which means a new building and NPC per area, or Moto78 only, which is simplest but means a trip back to town before every race day.

**Clash to settle:** the Spec says drinks unlock with the 125cc Youth class and are sold at the town gym. Boss's plan opens them in Area 4, whose badge class is 85cc Big Wheel. I've followed Boss's Area 4.

## Gaps found

### Area 1 must come first

These are Area 1 gaps, but Areas 2 to 8 build on them:

**Gaps 1 to 3 go in together as one piece of work** (Boss, 30 Oct 2026): XP per part made, a kept part at the end of each batch, and the batch rules. Area 1 uses the Spec's batch sizes, 50 at fabrication and 100 at the engine shop. The **tutorial** also changes: the first time the player talks to the engine rebuilder, they're told that a finished batch earns them a free part.

1. **Mechanical Engineer can't be levelled.** Shifts pay money but give no XP. The fabrication and engine shifts need XP for Welding, Bodywork, Machining and Engine Components, and the engine rebuild work needs Engine Assembly XP.
2. **No kept part from a batch.** A finished batch should give one random part (Spec 15.1). Without this, the "every part from a batch job" goal can't work anywhere.
3. **The batch rules aren't in.** The facility lock (one open job per facility, stop and come back later) and the batch sizes of 50 and 100 from the Spec still need building. Today's shifts are 20 brackets and 16 pistons.
4. **The tool shop is empty.** Its owner is now Jason Styles, at J's Tools. Tool sets gate DIY repairs (Spec 17.2a), and DIY repair itself isn't built yet. Tool slots in the house and motor aren't counted yet either.
5. **Job boards are missing.** Only one board gets built: customer repairs at Phoenix MX, in every area (Boss, 30 Oct 2026). The fabrication and engine boards are dropped, as the batch shifts cover them. A repair ticket plays as a station minigame, like the shifts (strip, fix, refit, test), never a single click on the bike like the tutorial.
6. **No Rider Ability drills at all.** Area 1 gets one: a **gate drop drill** at the backyard track for Starts (Boss, 30 Oct 2026). The view is a close-up of the front wheel by the gate. You watch the gate drop and react. It gets easier as Starts rises, as if the gate drops slower, but only at much later levels, so nobody gets the easier version from Area 1 alone without thousands of hours on it. This is a change from Spec 3 (Round 122, 4B), where a minigame stays the same as the skill rises.
7. **A broken Grade 1 frame can't be replaced** (see [When a frame breaks](#when-a-frame-breaks)).
8. **The Area 1 main championship.** Format locked in (Boss, 30 Oct 2026): 6 rounds, two at each Area 1 track, unlocked by the badge, and winning it unlocks the next class and the next area. Dean Marsh stays as the placeholder champion for now. It opens only once Area 2 is built, and **every Area Championship works the same way**: set up with its area, but only unlocked once the next area exists.

### Missing for Areas 2 to 8

9. **Rider pools.** Rules agreed (Boss, 31 Oct 2026):
   - **One pool of 44 riders**, not 20 new riders per area (Boss, 31 Oct 2026: six of Claude's newest names removed, leaving every name Boss gave). Local Champions for Areas 2 to 8 will come from this pool later, renamed and made NPCs.
   - Riders by area, before Local Champions are picked (each area adds that area's champion):

     | Area | Riders racing | Pool riders | NPCs who race | Joins here |
     |---|---|---|---|---|
     | 1 | 37 | 29 | 8 | Everyone not listed below |
     | 2 | 38 | 30 | 8 | Taylor Heart |
     | 3 | 39 | 31 | 8 | Aidan Gizard |
     | 4 | 40 | 32 | 8 | Kate Gizard |
     | 5 | 41 | 33 | 8 | Louie Gizard |
     | 6 | 42 | 34 | 8 | James Nestor |
     | 7 | 43 | 35 | 8 | Harvey Gizard |
     | 8 | 44 | 35 | 9 | Neal Gizard (NPC) |

     Once all 8 Local Champions are picked (Louis for Area 1, the other 7 from the pool, each waiting for their own area), each area adds two riders, its Local and Area Champion: **Area 1 30, Area 2 32, Area 3 34, Area 4 36, Area 5 38, Area 6 40, Area 7 42, Area 8 44** riders racing.

     **Who's in the field in each area** (Boss, 31 Oct 2026). Nobody the player has met ever leaves: every NPC, champion and challenger stays in the field from their own area onwards, through to Area 8. Their skill is set to the area of the track they're racing on, the same as everyone else. The 7 Local Champions (Areas 2 to 8) and 14 challengers (2 per area) are placeholders made from Claude's pool names, so the field grows by 2 each area, as each area's two champions join. More pool names may be added later.

     | Area | Boss's riders | Champions (Local + Area) | Challengers | Claude pool riders | Field |
     |---|---|---|---|---|---|
     | 1 | 10 | 2 | 2 | 16 | 30 |
     | 2 | 10 | 4 | 4 | 14 | 32 |
     | 3 | 10 | 6 | 6 | 12 | 34 |
     | 4 | 10 | 8 | 8 | 10 | 36 |
     | 5 | 10 | 10 | 10 | 8 | 38 |
     | 6 | 10 | 12 | 12 | 6 | 40 |
     | 7 | 10 | 14 | 14 | 4 | 42 |
     | 8 | 10 | 16 | 16 | 2 | 44 |

     Boss's riders here are the ones who aren't champions or challengers: Jeno Rothon, Bill Rothon, Jedrick Nicholls, Joseph Halden, Lee Stocky, Brandon Stocky, Jason Styles, Jordan Styles, Andy McLaren and Justin Smyth. Area 1's champions are Louis Jonez and Dean Marsh, and its challengers Mickey Alington and Dan Smyth. Claude's pool riders fall by 2 each area because those riders become that area's challengers.

     **Going back to an earlier area** (Boss, 31 Oct 2026): riders only ever race **forwards** from their own area, never backwards. A normal race day (not a championship) at an earlier area's track draws from that area's own row in the table above, at that area's skill level. So Area 1 race days always draw from Area 1's 30 riders, and a champion or challenger from a later area never turns up there. The one exception is a championship: a later area's main championship can hold rounds at earlier areas' tracks (Spec 18.6), and its field comes with it. For example, Neal Gizard races at Riverside Arena only in an Area 8 championship round held there, once the player has unlocked Area 8.

     **Championships keep their area's level** (Boss, 31 Oct 2026). Every championship belongs to one area and has a fixed skill level and field, set by that area. Replaying an old one, such as the Area 1 Local Champion Championship or the Area 1 Championship, races it at that same level every time, however far the player has got. Each championship will need its own name (parked with the other names).

     The 8 NPCs who race from Area 1 are Louis Jonez, Bill Rothon, Jedrick Nicholls, Joseph Halden, Lee Stocky, Jason Styles, Mickey Alington and Dan Smyth. A race day needs 15 CPU riders, a championship 19, and No-Turn Takedown (Area 7) 31.
   - **Future Area Champions are taken out of the pool** and added with their own area. There they win most of that area's races while the player levels up.
   - **NPCs who race join the pool in a set area**, their "area unlocked".
   - **AI skill follows the track's area, not the player.** Racing an Area 1 track late in the game puts the riders back at Area 1's skill set, so those races are easy and winnable most of the time. Area 8 still isn't guaranteed even at level 99.
   - Each rider's role (NPC or pool), joining area and champion area is being set on the rider sign-on sheet (an artifact for Boss).
10. **Local Champions.** Placeholders and an intro chain for every area are in [Arriving in a new area](#arriving-in-a-new-area-the-area-intro-boss-31-oct-2026). Boss will rename pool riders into these spots later.
11. **Challengers.** Two per area, so 14 names and 14 challenge tracks.
12. **Bike classes.** Only 50cc is in `bikes.json`. Every class from 65cc to Vets needs a stat ceiling, and the class milestone flow (win the championship, collect the new bike) needs building. Needed for Area 2. The class order follows the areas as in Spec 18.1 (Boss, 31 Oct 2026).
13. **Motor prices and storage.** Settled, see [Motors](#motors). Still to build: the Factory Hauler at every venue, and the sports car.
14. **Weather and rain.** Rain arrives in Area 2, Mountain Town (Spec 10.5), and isn't in yet. Then sand in Area 3, roots and loam in Area 4, rock and dust in Area 5, wind in Area 6, indoor in Area 7 and all weathers in Area 8. Kept as planned (Boss, 31 Oct 2026).
15. **Bike setup sliders** (Spec 8). These are what make the Mechanical Engineer level matter on race day, and they aren't in yet. Basic view arrives in Area 2, where rain first makes setup matter; Advanced view in Area 5 (Boss, 31 Oct 2026).
16. **Sponsors and reputation** (Spec 16). Agreed split (Boss, 31 Oct 2026): in Areas 1 to 4, winning the area championship brings a one-off champion's offer, the new class frame and a kit with no contract (turn it down and buy the frame from Bill). From Area 5, Sponsored Rides brings proper contracts (set race days, pay per objective, tiers from local shops to factory teams) and the reputation table. The factory tier brings the Factory Hauler.
17. **House tiers.** None can be bought yet. A house in every town and the one shared storage box need building (settled above).
18. **Clothing.** The wardrobe isn't built. It's needed for the Phoenix MX rack (Area 2, settled above) and sponsor kits.
19. **Unnamed NPCs.** The fabrication shop boss, engine rebuilder, neighbour and scrapyard owner keep their job titles for now (Boss, 31 Oct 2026).
20. **Mountain backdrop tiles** for Mountain Town (Area 2) need making (Boss, 30 Oct 2026).
21. **Hidden venues.** Dropped (Boss, 31 Oct 2026). The player is pointed to the challengers instead, and from Area 2 each challenger sets a short task before their challenge opens.

## Open decisions for Boss

1. ~~Area 2's name~~ Settled: Mountain Town (Boss, 30 Oct 2026).
2. ~~The Tyres and Wheels owner~~ Settled: Lee Stocky, Lee's T's & Wheels, travels to every area (Boss, 30 Oct 2026).
3. ~~Manny Festo~~ Settled: the news man in every area, no stall (Boss, 30 Oct 2026).
4. ~~Phoenix MX clothing~~ Settled: a small rack at Phoenix MX in Area 2, buyable once the Area 2 house unlocks the wardrobe (Boss, 30 Oct 2026).
5. ~~The class dealer~~ Settled: Bill Rothon at Moto78 sells the new class frame to riders who don't take the championship winner's sponsorship (Boss, 30 Oct 2026).
6. **Energy drinks (parked until closer to Area 4):** a drinks van at the venues (my recommendation), their own shop, or Moto78 only. And confirm Area 4 over the Spec's "from 125cc Youth".
7. ~~A second Modifying Machine~~ Settled: one machine, in Area 1, fixed by a quest line that starts in Area 5 (Boss, 30 Oct 2026). Fixing it needs Mechanical Engineer 30.
8. ~~The modifier machine owner's name~~ Settled: Mad Maggie, keeping her current look (Boss, 30 Oct 2026).
9. ~~Batch jobs per area~~ Settled: one new facility per area as planned, and a Frame works batch of 100 (Boss, 30 Oct 2026).
10. ~~Houses~~ Settled: a house in every town. Area 4 gets a reskinned Area 3 Semi, and Area 7 a reskinned Area 8 estate with no trophy and bike display room (Boss, 30 Oct 2026). House prices go up every area; the Area 7 house is £1,000,000.
11. ~~The fitness spread~~ Settled: weights (A2), agility ladder (A3), yoga (A4), rowing (A5), cycling (A6), dojo (A7), ice bath (A8) (Boss, 30 Oct 2026).
12. ~~Tools~~ Settled: three versions of each set (first, Pro and Master), all sold at the Area 1 tool shop; a second tool shop in Area 5 is a maybe (Boss, 30 Oct 2026).
13. ~~Frames~~ Settled: Moto78 always sells a stock Grade 1 frame of your brand for any unlocked class, and sponsors replace their broken frames free (Boss, 30 Oct 2026).
14. **Names.** Big Pete is his full name (Boss, 31 Oct 2026). The Local Champions, challengers, the Area 2 practice coach and every venue in Areas 2 to 8 keep their placeholders, and get their real names as each area is built.
