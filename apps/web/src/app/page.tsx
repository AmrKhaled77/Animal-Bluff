"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Client as ColyseusClient, Room as ColyseusRoom } from "colyseus.js";

type Language = "en" | "ar";
type ProfileAccent = "sage" | "sunshine" | "terracotta";
type Credentials = { roomCode: string; playerId: string; token: string };
type LobbyPlayer = {
  id: string;
  nickname: string;
  avatar: string;
  status: string;
  isReady: boolean;
};
type Lobby = {
  code: string;
  status: string;
  host: LobbyPlayer | null;
  playerCount: number;
  maxPlayers: number;
  lobbyExpiresAt: string;
  players: LobbyPlayer[];
};
type Card = {
  id: string;
  value: number;
  type?: string;
  ownerId: string | null;
  acquiredAt?: number | null;
  previousOwnerId?: string | null;
  acquisitionSource?: "AUCTION" | "KUHHANDEL" | null;
};
type Game = {
  version: number;
  phase: string;
  startedAt?: number;
  players: LobbyPlayer[];
  animals: Card[];
  currentPlayerId: string | null;
  firstPlayerId: string;
  auction: null | {
    animalCardId: string;
    auctioneerId: string;
    highBid: number;
    highBidderId: string | null;
    deadlineAt: number;
    choiceDeadlineAt: number | null;
    paymentDeadlineAt: number | null;
    payerId: string | null;
    payeeId: string | null;
    due: number;
  };
  negotiation: null | {
    challengerId: string;
    targetId: string;
    animalType: string;
    cardCount: number;
    deadlineAt: number;
    secondOfferIds: string[] | null;
    firstOfferValues: number[];
    secondOfferValues: number[];
    firstOfferTotal: number;
    secondOfferTotal: number;
  };
  ownMoney: Card[];
  publicReveal: null | { playerId: string; denominations: number[] };
  results: Array<{
    playerId: string;
    quartetCount: number;
    quartetValueSum: number;
    score: number;
    isWinner: boolean;
  }>;
  endReason: string | null;
};
type LogEntry = {
  sequence: number;
  eventType: string;
  occurredAt: string;
  actorPlayerId: string | null;
  targetPlayerId: string | null;
  animalType: string | null;
  animalCardCount: number | null;
  amount: number | null;
  outcomeCode: string | null;
  reasonCode: string | null;
  submittedMoneyDenominations: number[];
  submittedMoneyValue: number | null;
};
type RealtimeSync = {
  lobby: Lobby;
  game?: Game;
  log?: LogEntry[];
  serverNow?: number;
};
const server = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://127.0.0.1:2567";
const animals = [
  "HORSE",
  "COW",
  "PIG",
  "DONKEY",
  "GOAT",
  "SHEEP",
  "DOG",
  "CAT",
  "GOOSE",
  "ROOSTER",
];
const values: Record<string, number> = {
  HORSE: 1000,
  COW: 800,
  PIG: 650,
  DONKEY: 500,
  GOAT: 350,
  SHEEP: 250,
  DOG: 160,
  CAT: 90,
  GOOSE: 40,
  ROOSTER: 10,
};
const avatars = animals;
const helpSections: Record<Language, Array<{ title: string; body: string }>> = {
  en: [
    {
      title: "Goal and setup",
      body: "Play with 3–5 guests. Collect animal quartets: four cards of the same type. The server shuffles the 40 animal cards, selects the first player, and deals each player two 0s, four 10s, and one 50 (seven cards worth 90 total). Remaining money cards stay in the bank for Donkey distributions.",
    },
    {
      title: "Your turn",
      body: "While animals remain in the draw pile, choose an auction or an eligible Kuhhandel. After the pile is empty, Kuhhandel is compulsory. Turns pass clockwise; players with no legal action are skipped.",
    },
    {
      title: "Auctions",
      body: "The auctioneer reveals the next animal and cannot bid. The opening bid may be any positive amount; each later bid must be at least 10 higher. A valid bid resets the 15-second auction clock. When bidding closes, the auctioneer may buy the animal for the high bid; otherwise the high bidder buys it. Pay with money cards worth at least the price. Overpayment is allowed and no change is returned. With no bids, the auctioneer takes the animal for free.",
    },
    {
      title: "Donkeys",
      body: "When each Donkey is revealed, every player receives one bank card before its auction: 50 for the first, 100 for the second, 200 for the third, and 500 for the fourth. Donkeys are still ordinary animal quartets worth 500 points.",
    },
    {
      title: "Kuhhandel",
      body: "On your turn, challenge a connected player who has the same incomplete animal type. The server sets the number at stake: two cards each when both players have at least two, otherwise one each. Submit any number of your money cards, including none. The target must accept or counter. If accepted, you get the animal cards and the target keeps your offer. After a counter, both offers are exchanged; the higher total gets the animal cards. Equal totals go to the original challenger. The online game shows submitted offers to everyone. Completed quartets cannot be challenged.",
    },
    {
      title: "Scoring",
      body: "Only completed quartets count. Add their printed values, then multiply that sum by your number of completed quartets. Money has no final score value. Highest score wins; tied highest scores share victory.",
    },
    {
      title: "Examples",
      body: "If an animal costs 50 and you pay with cards worth 60, all 60 transfers and no change is returned. In a Kuhhandel counteroffer, equal totals go to the original challenger. For scoring, quartets worth 650, 160, and 10 sum to 820; with three quartets, the score is 820 × 3 = 2,460.",
    },
    {
      title: "Animal quartet values",
      body: "Horse 1,000 · Cow 800 · Pig 650 · Donkey 500 · Goat 350 · Sheep 250 · Dog 160 · Cat 90 · Goose 40 · Rooster 10.",
    },
  ],
  ar: [
    {
      title: "الهدف والتجهيز",
      body: "العبوا من 3 إلى 5 لاعبين. اجمع رباعيات الحيوانات: أربع بطاقات من النوع نفسه. يخلط الخادم 40 بطاقة حيوان ويختار أول لاعب، ثم يوزع على كل لاعب بطاقتين بقيمة 0 وأربع بطاقات بقيمة 10 وبطاقة بقيمة 50؛ أي سبع بطاقات بقيمة إجمالية 90. تبقى أوراق المال الأخرى في البنك لتوزيعات الحمير.",
    },
    {
      title: "دورك",
      body: "ما دامت بطاقات الحيوانات متبقية، اختر مزاداً أو مقايضة مؤهلة. بعد نفاد الرزمة تصبح المقايضة إلزامية. تنتقل الأدوار باتجاه عقارب الساعة، ويُتخطى اللاعب الذي لا يملك حركة قانونية.",
    },
    {
      title: "المزاد",
      body: "يكشف صاحب الدور بطاقة الحيوان ولا يحق له المزايدة. يمكن أن تكون المزايدة الأولى أي مبلغ موجب، ويجب أن تزيد كل مزايدة لاحقة 10 على الأقل. تعيد المزايدة المقبولة مؤقت المزاد إلى 15 ثانية. بعد إغلاق المزايدة يستطيع صاحب الدور شراء الحيوان بسعر أعلى مزايدة؛ وإلا يشتريه صاحب أعلى مزايدة. ادفع أوراقاً تساوي السعر أو تزيد عليه، ولا يُعاد الباقي. إذا لم يزايد أحد، يأخذ صاحب الدور الحيوان مجاناً.",
    },
    {
      title: "الحمير",
      body: "عند كشف كل حمار، يحصل كل لاعب على ورقة من البنك قبل مزاده: 50 للأول، و100 للثاني، و200 للثالث، و500 للرابع. وتبقى الحمير رباعيات عادية قيمتها 500 نقطة.",
    },
    {
      title: "المقايضة",
      body: "في دورك، تحدَّ لاعباً متصلاً يملك النوع نفسه ضمن مجموعة غير مكتملة. يحدد الخادم العدد: بطاقتان من كل لاعب إذا كان لدى كليهما بطاقتان على الأقل، وإلا بطاقة واحدة من كل لاعب. أرسل أي عدد من أوراق المال، حتى دون أوراق. على اللاعب الآخر القبول أو تقديم عرض مضاد. عند القبول تحصل على بطاقات الحيوان ويحتفظ الآخر بعرضك. بعد العرض المضاد يتبادل اللاعبان الأوراق؛ ويحصل صاحب القيمة الأعلى على بطاقات الحيوان. عند التعادل يفوز المتحدي الأصلي. تظهر العروض المرسلة للجميع في اللعبة الرقمية. لا يمكن تحدي رباعية مكتملة.",
    },
    {
      title: "النقاط",
      body: "تُحتسب الرباعيات المكتملة فقط. اجمع قيمها المطبوعة ثم اضرب المجموع في عدد رباعياتك المكتملة. لا تُحتسب الأموال في النتيجة النهائية. يفوز صاحب أعلى نتيجة، ويتشارك المتعادلون الأعلى الفوز.",
    },
    {
      title: "أمثلة",
      body: "إذا كان سعر الحيوان 50 ودفعت أوراقاً مجموعها 60، تنتقل الأوراق الستون كلها ولا يُعاد الباقي. في المقايضة، إذا تساوت قيمة العرضين يفوز المتحدي الأصلي. ولحساب النقاط، مجموع رباعيات قيمها 650 و160 و10 هو 820؛ ومع ثلاث رباعيات تكون النتيجة 820 × 3 = ٢٬٤٦٠.",
    },
    {
      title: "قيم رباعيات الحيوانات",
      body: "الحصان ١٬٠٠٠ · البقرة ٨٠٠ · الخنزير ٦٥٠ · الحمار ٥٠٠ · الماعز ٣٥٠ · الخروف ٢٥٠ · الكلب ١٦٠ · القط ٩٠ · الإوزة ٤٠ · الديك ١٠.",
    },
  ],
};
const words = {
  en: {
    title: "Animal Bluff",
    subtitle: "A lively table for clever traders.",
    create: "Create a room",
    join: "Join a room",
    nickname: "Nickname",
    avatar: "Choose your animal",
    roomCode: "Room code",
    ready: "I’m ready",
    unready: "Not ready",
    start: "Start match",
    close: "Close room",
    kick: "Remove",
    updateProfile: "Update my profile",
    confirmKick: "Remove this player from the room?",
    confirmClose: "Close this room for everyone?",
    playerRemoved: "You were removed from this room.",
    roomClosed: "The host closed this room.",
    share: "Share this room",
    copy: "Copy invite link",
    createTitle: "Start a table",
    joinTitle: "Join friends",
    waiting: "Waiting for the host…",
    players: "Players",
    lobby: "Lobby",
    game: "Game",
    turn: "Your turn",
    waitingTurn: "Waiting for the current player",
    auction: "Start an auction",
    bid: "Bid amount",
    placeBid: "Place bid",
    quickBid: "Quick bids",
    bidHistory: "Accepted bids",
    minimumBid: "Minimum next bid",
    highBidder: "High bidder",
    noChange: "No change is returned",
    paymentShort: "Select enough cards to cover the amount due.",
    initialOffer: "Submitted offer",
    emptyOffer: "Empty offer",
    challenger: "Challenger",
    challenged: "Challenged player",
    buy: "Buy animal",
    pass: "Let winner buy",
    pay: "Choose money cards and pay",
    confirm: "Confirm payment",
    trade: "Start a Kuhhandel",
    target: "Choose a player",
    makeOffer: "Submit offer",
    accept: "Accept offer",
    counter: "Counter offer",
    results: "Match results",
    viewLog: "View game log",
    backHome: "Back to home",
    noResult:
      "The match ended without a result because no players remained connected.",
    winner: "Winner",
    sharedVictory: "Shared victory",
    completedQuartets: "Completed quartets",
    quartetValueSum: "Quartet value sum",
    log: "Game log",
    help: "How to play",
    settings: "Settings",
    sound: "Sound effects",
    backgroundMusic: "Background music",
    notificationsSound: "Notification sounds",
    volume: "Volume",
    reduceMotion: "Reduce motion",
    textSize: "Text size",
    localProfile: "Local profile for future rooms",
    profileColor: "Avatar frame color",
    accentSage: "Sage",
    accentSunshine: "Sunshine",
    accentTerracotta: "Terracotta",
    auctionEndingSoon: "Auction ending soon",
    deadlineSoon: "Deadline approaching",
    shuffling: "Shuffling cards and dealing…",
    firstPlayer: "First player",
    language: "Language",
    back: "Back to table",
    playersNotReady:
      "Everyone must be ready; at least three players are required.",
    myCards: "Your money cards",
    animalsOwned: "Animal collection",
    animalCards: "animal cards",
    emptySet: "No cards yet",
    selected: "selected",
    clearSelection: "Clear",
    statistics: "Match statistics",
    auctionsPlayed: "Auctions participated in",
    auctionsWon: "Auctions won",
    tradesWon: "Kuhhandel deals won",
    duration: "Match duration",
    previousOwner: "Previous owner",
    acquired: "Acquired",
    auctionSource: "Auction",
    tradeSource: "Kuhhandel",
    loading: "Loading…",
    error: "Something went wrong",
    connected: "Connected",
    host: "Host",
    forfeit: "Forfeited",
    noLog: "No events yet.",
    amount: "Total",
    inviteCopied: "Invite link copied.",
    waitingDecision:
      "This action needs a game-rule decision before play can continue.",
    helpText:
      "Collect animal quartets through auctions and Kuhhandel. Money is not scored. The server deals each player seven money cards worth 90 in total. A quartet is worth its printed value multiplied by your completed quartet count. Highest score wins; tied highest scores share victory.",
  },
  ar: {
    title: "خد وهات",
    subtitle: "لعبة جماعية للمساومة والذكاء.",
    create: "أنشئ غرفة",
    join: "انضم إلى غرفة",
    nickname: "الاسم المستعار",
    avatar: "اختر حيوانك",
    roomCode: "رمز الغرفة",
    ready: "أنا جاهز",
    unready: "إلغاء الجاهزية",
    start: "ابدأ المباراة",
    close: "أغلق الغرفة",
    kick: "إزالة",
    updateProfile: "تحديث بياناتي",
    confirmKick: "هل تريد إزالة هذا اللاعب من الغرفة؟",
    confirmClose: "هل تريد إغلاق الغرفة للجميع؟",
    playerRemoved: "تمت إزالتك من هذه الغرفة.",
    roomClosed: "أغلق المضيف هذه الغرفة.",
    share: "شارك الغرفة",
    copy: "نسخ رابط الدعوة",
    createTitle: "ابدأ طاولة",
    joinTitle: "انضم إلى الأصدقاء",
    waiting: "بانتظار المضيف…",
    players: "اللاعبون",
    lobby: "الردهة",
    game: "اللعبة",
    turn: "دورك",
    waitingTurn: "بانتظار اللاعب الحالي",
    auction: "ابدأ مزاداً",
    bid: "قيمة المزايدة",
    placeBid: "زايد",
    quickBid: "مزايدات سريعة",
    bidHistory: "المزايدات المقبولة",
    minimumBid: "أقل مزايدة تالية",
    highBidder: "أعلى مزايد",
    noChange: "لا يُعاد الباقي",
    paymentShort: "اختر أوراقاً تكفي لتغطية المبلغ المطلوب.",
    initialOffer: "العرض المرسل",
    emptyOffer: "عرض بلا أوراق",
    challenger: "المتحدي",
    challenged: "اللاعب المتحدّى",
    buy: "اشتر الحيوان",
    pass: "دع الفائز يشتري",
    pay: "اختر أوراق المال وادفع",
    confirm: "تأكيد الدفع",
    trade: "ابدأ مقايضة",
    target: "اختر لاعباً",
    makeOffer: "أرسل العرض",
    accept: "اقبل العرض",
    counter: "قدم عرضاً مضاداً",
    results: "نتائج المباراة",
    viewLog: "عرض سجل اللعبة",
    backHome: "العودة إلى الرئيسية",
    noResult: "انتهت المباراة دون نتيجة لعدم بقاء لاعبين متصلين.",
    winner: "الفائز",
    sharedVictory: "فوز مشترك",
    completedQuartets: "الرباعيات المكتملة",
    quartetValueSum: "مجموع قيم الرباعيات",
    log: "سجل اللعبة",
    help: "طريقة اللعب",
    settings: "الإعدادات",
    sound: "المؤثرات الصوتية",
    backgroundMusic: "الموسيقى الخلفية",
    notificationsSound: "أصوات التنبيه",
    volume: "مستوى الصوت",
    reduceMotion: "تقليل الحركة",
    textSize: "حجم النص",
    localProfile: "الملف المحلي للغرف القادمة",
    profileColor: "لون إطار الصورة",
    accentSage: "أخضر هادئ",
    accentSunshine: "ذهبي",
    accentTerracotta: "طوبي",
    auctionEndingSoon: "المزاد يوشك على الانتهاء",
    deadlineSoon: "اقترب الموعد النهائي",
    shuffling: "جارٍ خلط الأوراق وتوزيعها…",
    firstPlayer: "اللاعب الأول",
    language: "اللغة",
    back: "العودة إلى الطاولة",
    playersNotReady:
      "يجب أن يكون الجميع جاهزين مع وجود ثلاثة لاعبين على الأقل.",
    myCards: "أوراق المال الخاصة بك",
    animalsOwned: "مجموعة الحيوانات",
    animalCards: "بطاقات الحيوانات",
    emptySet: "لا توجد بطاقات بعد",
    selected: "محددة",
    clearSelection: "مسح",
    statistics: "إحصاءات المباراة",
    auctionsPlayed: "المزادات التي شاركت فيها",
    auctionsWon: "المزادات التي فزت بها",
    tradesWon: "صفقات المقايضة التي فزت بها",
    duration: "مدة المباراة",
    previousOwner: "المالك السابق",
    acquired: "تاريخ الاقتناء",
    auctionSource: "مزاد",
    tradeSource: "مقايضة",
    loading: "جار التحميل…",
    error: "حدث خطأ",
    connected: "متصل",
    host: "المضيف",
    forfeit: "منسحب",
    noLog: "لا توجد أحداث بعد.",
    amount: "الإجمالي",
    inviteCopied: "تم نسخ رابط الدعوة.",
    waitingDecision: "تحتاج هذه الحالة إلى قرار بقواعد اللعبة قبل المتابعة.",
    helpText:
      "اجمع رباعيات الحيوانات بالمزاد والمقايضة. لا تُحتسب الأموال في النقاط. يوزّع الخادم سبع أوراق مال على كل لاعب بقيمة إجمالية 90. قيمة الرباعية هي قيمتها المطبوعة مضروبة بعدد رباعياتك المكتملة. يفوز صاحب أعلى نتيجة، ويتشارك المتعادلون الفوز.",
  },
} as const;

async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${server}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error("SERVER_UNAVAILABLE");
    throw error;
  }
  const data =
    response.status === 204
      ? undefined
      : await response.json().catch(() => undefined);
  if (!response.ok)
    throw new Error(data?.error?.code ?? `HTTP_${response.status}`);
  return data as T;
}
function avatarName(avatar: string, lang: Language) {
  const ar: Record<string, string> = {
    HORSE: "حصان",
    COW: "بقرة",
    PIG: "خنزير",
    DONKEY: "حمار",
    GOAT: "ماعز",
    SHEEP: "خروف",
    DOG: "كلب",
    CAT: "قط",
    GOOSE: "إوزة",
    ROOSTER: "ديك",
  };
  return lang === "ar"
    ? (ar[avatar] ?? avatar)
    : avatar[0] + avatar.slice(1).toLowerCase();
}
function animalIcon(animal: string) {
  const icons: Record<string, string> = {
    HORSE: "🐴",
    COW: "🐮",
    PIG: "🐷",
    DONKEY: "🫏",
    GOAT: "🐐",
    SHEEP: "🐑",
    DOG: "🐕",
    CAT: "🐈",
    GOOSE: "🪿",
    ROOSTER: "🐓",
  };
  return icons[animal] ?? "🐾";
}
function errorText(code: string, lang: Language) {
  const en: Record<string, string> = {
    INTERNAL_ERROR:
      process.env.NODE_ENV === "development"
        ? "The game server encountered an unexpected error. Check the backend terminal for details."
        : "The game could not complete that request. Please try again.",
    SERVER_UNAVAILABLE:
      process.env.NODE_ENV === "development"
        ? "Cannot reach the game server. Check that the backend is running on port 2567."
        : "The game server is unavailable. Please try again shortly.",
    INVALID_INPUT: "Check the nickname and try again.",
    INVALID_AVATAR: "Choose one of the built-in animals.",
    ROOM_NOT_FOUND: "That room could not be found.",
    ROOM_FULL: "The room is full.",
    ROOM_EXPIRED: "This lobby has expired.",
    ROOM_NOT_LOBBY: "This room is no longer accepting lobby actions.",
    DUPLICATE_NICKNAME: "That exact nickname is already in the room.",
    DUPLICATE_AVATAR: "That animal avatar is already chosen in this room.",
    PLAYER_REMOVED: words[lang].playerRemoved,
    ROOM_CLOSED: words[lang].roomClosed,
    HOST_ONLY: "Only the host can do that.",
    NOT_ENOUGH_PLAYERS: "At least three players are needed.",
    PLAYERS_NOT_READY: "Everyone needs to be ready before the match starts.",
    NOT_YOUR_TURN: "It is not your turn.",
    INVALID_PHASE: "That action is not available now.",
    PAYMENT_INSUFFICIENT: "Select money cards worth at least the amount due.",
    NO_ELIGIBLE_PLAYER: "There is no eligible player for that trade.",
    RULE_DECISION_REQUIRED: words[lang].waitingDecision,
  };
  const ar: Record<string, string> = {
    INTERNAL_ERROR:
      process.env.NODE_ENV === "development"
        ? "حدث خطأ غير متوقع في خادم اللعبة. راجع سجل الخادم للتفاصيل."
        : "تعذر تنفيذ الطلب. حاول مرة أخرى.",
    SERVER_UNAVAILABLE:
      process.env.NODE_ENV === "development"
        ? "تعذر الاتصال بخادم اللعبة. تحقق من تشغيل الخادم على المنفذ 2567."
        : "خادم اللعبة غير متاح. حاول مرة أخرى بعد قليل.",
    INVALID_INPUT: "تحقق من الاسم وحاول مرة أخرى.",
    INVALID_AVATAR: "اختر حيواناً من القائمة.",
    ROOM_NOT_FOUND: "تعذر العثور على هذه الغرفة.",
    ROOM_FULL: "الغرفة ممتلئة.",
    ROOM_EXPIRED: "انتهت صلاحية الردهة.",
    ROOM_NOT_LOBBY: "لم تعد الغرفة تقبل إجراءات الردهة.",
    DUPLICATE_NICKNAME: "هذا الاسم مستخدم بالفعل في الغرفة.",
    DUPLICATE_AVATAR: "تم اختيار هذا الحيوان بالفعل في الغرفة.",
    PLAYER_REMOVED: words[lang].playerRemoved,
    ROOM_CLOSED: words[lang].roomClosed,
    HOST_ONLY: "هذا الإجراء متاح للمضيف فقط.",
    NOT_ENOUGH_PLAYERS: "يلزم وجود ثلاثة لاعبين على الأقل.",
    PLAYERS_NOT_READY: "يجب أن يستعد الجميع قبل بدء المباراة.",
    NOT_YOUR_TURN: "ليس دورك الآن.",
    INVALID_PHASE: "هذا الإجراء غير متاح الآن.",
    PAYMENT_INSUFFICIENT: "اختر أوراق مال تبلغ قيمتها المطلوبة أو أكثر.",
    NO_ELIGIBLE_PLAYER: "لا يوجد لاعب مؤهل لهذه المقايضة.",
    RULE_DECISION_REQUIRED: words[lang].waitingDecision,
  };
  return (lang === "ar" ? ar[code] : en[code]) ?? words[lang].error;
}

function playTone(volume: number) {
  if (volume <= 0 || typeof window === "undefined") return;
  try {
    const AudioContextType =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextType) return;
    const context = new AudioContextType();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.1);
    gain.gain.setValueAtTime(Math.min(volume, 1) * 0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
    window.setTimeout(() => void context.close(), 400);
  } catch {
    // Browser audio can be unavailable or blocked by autoplay settings.
  }
}

function createAmbientMusic(volume: number) {
  if (typeof window === "undefined") return null;
  const AudioContextType =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextType) return null;
  try {
    const context = new AudioContextType();
    const master = context.createGain();
    master.gain.value = Math.max(0, Math.min(1, volume)) * 0.22;
    master.connect(context.destination);
    const notes = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23];
    let noteIndex = 0;
    const playNote = () => {
      const frequency = notes[noteIndex++ % notes.length]!;
      const startAt = context.currentTime;
      for (const [hz, level] of [
        [frequency, 0.035],
        [frequency * 1.5, 0.012],
      ]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = hz!;
        envelope.gain.setValueAtTime(0.0001, startAt);
        envelope.gain.exponentialRampToValueAtTime(level!, startAt + 0.12);
        envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.8);
        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.82);
      }
    };
    playNote();
    const timer = window.setInterval(playNote, 900);
    return {
      setVolume: (next: number) => {
        master.gain.setTargetAtTime(
          Math.max(0, Math.min(1, next)) * 0.22,
          context.currentTime,
          0.15,
        );
      },
      stop: () => {
        window.clearInterval(timer);
        void context.close();
      },
    };
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [lang, setLang] = useState<Language>("en");
  const [view, setView] = useState<
    "home" | "lobby" | "starting" | "game" | "help" | "settings"
  >("home");
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState<string>("HORSE");
  const [profileInitializedFor, setProfileInitializedFor] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bid, setBid] = useState(10);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [tradeAnimal, setTradeAnimal] = useState("HORSE");
  const [tradeTarget, setTradeTarget] = useState("");
  const [filterActor, setFilterActor] = useState("");
  const [filterEvent, setFilterEvent] = useState("");
  const [soundEffects, setSoundEffects] = useState(true);
  const [backgroundMusic, setBackgroundMusic] = useState(false);
  const [notificationSound, setNotificationSound] = useState(true);
  const [volume, setVolume] = useState(60);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [textScale, setTextScale] = useState(100);
  const [profileAccent, setProfileAccent] = useState<ProfileAccent>("sage");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const lastLogSequence = useRef(0);
  const lastAuctionAlert = useRef(0);
  const musicController = useRef<ReturnType<typeof createAmbientMusic>>(null);
  const realtimeRoom = useRef<ColyseusRoom | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const t = words[lang];
  const languageRef = useRef(lang);
  languageRef.current = lang;
  const rtl = lang === "ar";
  const self = credentials?.playerId ?? "";
  const isHost = lobby?.host?.id === self;
  const eligibleTradeTypes = useMemo(() => {
    if (!game || !self) return [];
    return animals.filter((animal) => {
      const ownCount = game.animals.filter(
        (card) => card.ownerId === self && card.type === animal,
      ).length;
      return (
        ownCount > 0 &&
        ownCount < 4 &&
        game.players.some(
          (player) =>
            player.id !== self &&
            player.status === "CONNECTED" &&
            game.animals.some(
              (card) => card.ownerId === player.id && card.type === animal,
            ) &&
            game.animals.filter(
              (card) => card.ownerId === player.id && card.type === animal,
            ).length < 4,
        )
      );
    });
  }, [game, self]);
  const selectedTradeAnimal = eligibleTradeTypes.includes(tradeAnimal)
    ? tradeAnimal
    : (eligibleTradeTypes[0] ?? "");
  const eligibleTradeTargets = useMemo(() => {
    if (!game || !selectedTradeAnimal) return [];
    return game.players.filter((player) => {
      if (player.id === self || player.status !== "CONNECTED") return false;
      const count = game.animals.filter(
        (card) =>
          card.ownerId === player.id && card.type === selectedTradeAnimal,
      ).length;
      return count > 0 && count < 4;
    });
  }, [game, selectedTradeAnimal, self]);
  const filteredLog = useMemo(
    () =>
      log.filter(
        (e) =>
          (!filterActor ||
            e.actorPlayerId === filterActor ||
            e.targetPlayerId === filterActor) &&
          (!filterEvent || e.eventType === filterEvent),
      ),
    [log, filterActor, filterEvent],
  );
  const statistics = useMemo(() => {
    if (!game || !game.results.length) return null;
    const starts = log.filter((event) => event.eventType === "AUCTION_STARTED");
    const startFor = (sequence: number) =>
      starts.filter((event) => event.sequence < sequence).at(-1);
    const endTime = log.find(
      (event) => event.eventType === "MATCH_ENDED",
    )?.occurredAt;
    const startTime = log.find(
      (event) => event.eventType === "MATCH_STARTED",
    )?.occurredAt;
    const durationMs =
      startTime && endTime
        ? Math.max(0, Date.parse(endTime) - Date.parse(startTime))
        : 0;
    return game.players.map((player) => {
      const participated = new Set<number>();
      for (const event of log) {
        if (
          event.eventType === "AUCTION_STARTED" &&
          event.actorPlayerId === player.id
        )
          participated.add(event.sequence);
        if (
          event.eventType === "BID_ACCEPTED" &&
          event.actorPlayerId === player.id
        ) {
          const start = startFor(event.sequence);
          if (start) participated.add(start.sequence);
        }
      }
      let auctionsWon = log.filter(
        (event) =>
          event.eventType === "AUCTION_CLOSED" &&
          event.outcomeCode === "NO_BIDS_FREE" &&
          event.actorPlayerId === player.id,
      ).length;
      for (let index = 0; index < log.length; index++) {
        if (
          log[index]?.eventType === "PAYMENT_SUCCEEDED" &&
          log[index + 1]?.eventType === "ANIMAL_TRANSFERRED" &&
          log[index + 1]?.targetPlayerId === player.id
        )
          auctionsWon++;
      }
      return {
        player,
        auctionsPlayed: participated.size,
        auctionsWon,
        tradesWon: log.filter(
          (event) =>
            event.eventType === "KUHHANDEL_RESOLVED" &&
            event.actorPlayerId === player.id,
        ).length,
        quartetCount:
          game.results.find((result) => result.playerId === player.id)
            ?.quartetCount ?? 0,
        quartetValueSum:
          game.results.find((result) => result.playerId === player.id)
            ?.quartetValueSum ?? 0,
        durationMs,
      };
    });
  }, [game, log]);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const actionDeadline =
    game?.phase === "AUCTION"
      ? game.auction?.deadlineAt
      : game?.phase === "AUCTIONEER_CHOICE"
        ? game.auction?.choiceDeadlineAt
        : game?.phase === "PAYMENT"
          ? game.auction?.paymentDeadlineAt
          : game?.phase === "NEGOTIATION"
            ? game.negotiation?.deadlineAt
            : null;
  const remainingSeconds = actionDeadline
    ? Math.max(
        0,
        Math.ceil((actionDeadline - (clockNow + serverClockOffsetMs)) / 1000),
      )
    : null;
  const auctionEndingSoon =
    game?.phase === "AUCTION" &&
    remainingSeconds !== null &&
    remainingSeconds <= 5;
  const deadlineSoon =
    (game?.phase === "PAYMENT" || game?.phase === "NEGOTIATION") &&
    remainingSeconds !== null &&
    remainingSeconds <= 10;

  useEffect(() => {
    try {
      const stored = localStorage.getItem("animal-bluff-settings");
      if (stored) {
        const settings = JSON.parse(stored) as Partial<{
          lang: Language;
          sound?: boolean;
          soundEffects?: boolean;
          backgroundMusic?: boolean;
          notificationSound: boolean;
          volume: number;
          reduceMotion: boolean;
          textScale: number;
          nickname: string;
          avatar: string;
          profileAccent: ProfileAccent;
        }>;
        if (settings.lang === "en" || settings.lang === "ar")
          setLang(settings.lang);
        if (typeof settings.soundEffects === "boolean")
          setSoundEffects(settings.soundEffects);
        else if (typeof settings.sound === "boolean")
          setSoundEffects(settings.sound);
        if (typeof settings.backgroundMusic === "boolean")
          setBackgroundMusic(settings.backgroundMusic);
        if (typeof settings.notificationSound === "boolean")
          setNotificationSound(settings.notificationSound);
        if (typeof settings.volume === "number")
          setVolume(Math.max(0, Math.min(100, settings.volume)));
        if (typeof settings.reduceMotion === "boolean")
          setReduceMotion(settings.reduceMotion);
        if (typeof settings.textScale === "number")
          setTextScale(Math.max(85, Math.min(130, settings.textScale)));
        if (
          settings.profileAccent === "sage" ||
          settings.profileAccent === "sunshine" ||
          settings.profileAccent === "terracotta"
        )
          setProfileAccent(settings.profileAccent);
        if (typeof settings.nickname === "string")
          setNickname(settings.nickname);
        if (
          typeof settings.avatar === "string" &&
          avatars.includes(settings.avatar)
        )
          setAvatar(settings.avatar);
      }
    } catch {
      localStorage.removeItem("animal-bluff-settings");
    }
    setSettingsLoaded(true);
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem(
      "animal-bluff-settings",
      JSON.stringify({
        lang,
        soundEffects,
        backgroundMusic,
        notificationSound,
        volume,
        reduceMotion,
        textScale,
        nickname,
        avatar,
        profileAccent,
      }),
    );
  }, [
    avatar,
    lang,
    nickname,
    notificationSound,
    profileAccent,
    reduceMotion,
    settingsLoaded,
    soundEffects,
    backgroundMusic,
    textScale,
    volume,
  ]);

  useEffect(() => {
    if (!settingsLoaded || !backgroundMusic) return;
    musicController.current = createAmbientMusic(volume / 100);
    return () => {
      musicController.current?.stop();
      musicController.current = null;
    };
  }, [backgroundMusic, settingsLoaded]);

  useEffect(() => {
    musicController.current?.setVolume(volume / 100);
  }, [volume]);

  useEffect(() => {
    const newest = log.at(-1)?.sequence ?? 0;
    if (!newest) return;
    if (lastLogSequence.current === 0) {
      lastLogSequence.current = newest;
      return;
    }
    const fresh = log.filter(
      (event) => event.sequence > lastLogSequence.current,
    );
    lastLogSequence.current = newest;
    const celebration = fresh.some((event) =>
      ["QUARTET_COMPLETED", "MATCH_ENDED"].includes(event.eventType),
    );
    const notification = fresh.some((event) =>
      [
        "TURN_STARTED",
        "KUHHANDEL_OFFER_SUBMITTED",
        "PLAYER_DISCONNECTED",
        "PLAYER_RECONNECTED",
      ].includes(event.eventType),
    );
    if (celebration && soundEffects) playTone(volume / 100);
    if (notification && notificationSound) playTone(volume / 100);
  }, [log, notificationSound, soundEffects, volume]);

  useEffect(() => {
    const deadline =
      game?.phase === "AUCTION" ? game.auction?.deadlineAt : null;
    if (
      deadline &&
      remainingSeconds !== null &&
      remainingSeconds > 0 &&
      remainingSeconds <= 5 &&
      lastAuctionAlert.current !== deadline
    ) {
      lastAuctionAlert.current = deadline;
      if (notificationSound) playTone(volume / 100);
    }
  }, [game, notificationSound, remainingSeconds, volume]);

  const loadRoom = useCallback(
    async (cred: Credentials) => {
      try {
        await request(`/api/rooms/${cred.roomCode}/heartbeat`, {
          token: cred.token,
        });
        const current = await request<Lobby>(
          `/api/rooms/${cred.roomCode}`,
          undefined,
          "GET",
        );
        setLobby(current);
        if (current.status === "IN_MATCH" || current.status === "COMPLETED") {
          const result = await request<{
            game: Game;
            log: LogEntry[];
            serverNow: number;
          }>(`/api/rooms/${cred.roomCode}/snapshot`, { token: cred.token });
          setGame(result.game);
          setLog(result.log);
          setServerClockOffsetMs(result.serverNow - Date.now());
          setView("game");
        } else setView("lobby");
      } catch {
        try {
          await request<Lobby>(`/api/rooms/${cred.roomCode}/reconnect`, {
            token: cred.token,
            playerId: cred.playerId,
          });
          await loadRoom(cred);
        } catch (reconnectError) {
          localStorage.removeItem("animal-bluff-guest");
          setCredentials(null);
          setView("home");
          setError(
            errorText(
              reconnectError instanceof Error
                ? reconnectError.message
                : "ROOM_NOT_FOUND",
              lang,
            ),
          );
        }
      }
    },
    [lang],
  );

  useEffect(() => {
    if (!credentials) return;
    let active = true;
    let heartbeatTimer: number | undefined;
    let joinedRoom: ColyseusRoom | null = null;
    const client = new ColyseusClient(server);
    void client
      .joinOrCreate("animal-bluff", {
        roomCode: credentials.roomCode,
        playerId: credentials.playerId,
        token: credentials.token,
      })
      .then((room) => {
        if (!active) {
          void room.leave();
          return;
        }
        joinedRoom = room;
        realtimeRoom.current = room;
        room.onMessage("sync", (payload: RealtimeSync) => {
          setLobby(payload.lobby);
          if (payload.game) {
            setGame(payload.game);
            setLog(payload.log ?? []);
            if (payload.serverNow !== undefined)
              setServerClockOffsetMs(payload.serverNow - Date.now());
            setView((current) =>
              current === "help" ||
              current === "settings" ||
              current === "starting"
                ? current
                : "game",
            );
          } else {
            setView((current) =>
              current === "help" || current === "settings" ? current : "lobby",
            );
          }
        });
        room.onMessage("action_result", () => {
          setBusy(false);
          setSelectedCards([]);
        });
        room.onMessage("action_error", (result: { code?: string }) => {
          setBusy(false);
          setError(
            errorText(result.code ?? "INTERNAL_ERROR", languageRef.current),
          );
        });
        room.onMessage("room_closed", () => {
          localStorage.removeItem("animal-bluff-guest");
          setCredentials(null);
          setLobby(null);
          setGame(null);
          setView("home");
          setError(errorText("ROOM_CLOSED", languageRef.current));
        });
        room.onError(() => {
          if (active && realtimeRoom.current === room)
            realtimeRoom.current = null;
        });
        room.onLeave(() => {
          if (active && realtimeRoom.current === room)
            realtimeRoom.current = null;
        });
        room.send("sync");
        room.send("heartbeat");
        heartbeatTimer = window.setInterval(
          () => room.send("heartbeat"),
          2_500,
        );
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            errorText(
              reason instanceof Error ? reason.message : "INTERNAL_ERROR",
              languageRef.current,
            ),
          );
      });
    return () => {
      active = false;
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      if (realtimeRoom.current === joinedRoom) realtimeRoom.current = null;
      if (joinedRoom) void joinedRoom.leave();
    };
  }, [credentials]);

  useEffect(() => {
    const inviteCode = new URLSearchParams(window.location.search).get("room");
    if (inviteCode && /^[A-Z0-9]{6}$/i.test(inviteCode))
      setRoomInput(inviteCode.toUpperCase());
    const raw = localStorage.getItem("animal-bluff-guest");
    if (!raw) return;
    try {
      const cred = JSON.parse(raw) as Credentials;
      setCredentials(cred);
      void loadRoom(cred);
    } catch {
      localStorage.removeItem("animal-bluff-guest");
    }
  }, [loadRoom]);

  useEffect(() => {
    if (view !== "lobby" || !lobby || !self || profileInitializedFor === self)
      return;
    const ownProfile = lobby.players.find((player) => player.id === self);
    if (!ownProfile) return;
    setNickname(ownProfile.nickname);
    setAvatar(ownProfile.avatar);
    setProfileInitializedFor(self);
  }, [lobby, profileInitializedFor, self, view]);

  useEffect(() => {
    if (
      !credentials ||
      view === "home" ||
      view === "help" ||
      view === "settings"
    )
      return;
    const poll = window.setInterval(() => {
      if (!realtimeRoom.current) void loadRoom(credentials);
    }, 2_500);
    const onExit = () => {
      void fetch(`${server}/api/rooms/${credentials.roomCode}/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: credentials.token }),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", onExit);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("pagehide", onExit);
    };
  }, [credentials, view, loadRoom]);

  useEffect(() => {
    if (!credentials || (view !== "help" && view !== "settings")) return;
    const heartbeat = () => {
      if (realtimeRoom.current) {
        realtimeRoom.current.send("heartbeat");
        return;
      }
      void request(`/api/rooms/${credentials.roomCode}/heartbeat`, {
        token: credentials.token,
      }).catch(() => undefined);
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 2_500);
    return () => window.clearInterval(interval);
  }, [credentials, view]);

  async function enter(create: boolean) {
    setBusy(true);
    setError("");
    try {
      const body = { nickname, avatar };
      const result = await request<{
        playerId: string;
        reconnectToken: string;
        lobby: Lobby;
      }>(
        create
          ? "/api/rooms"
          : `/api/rooms/${roomInput.trim().toUpperCase()}/join`,
        body,
      );
      const cred = {
        roomCode: result.lobby.code,
        playerId: result.playerId,
        token: result.reconnectToken,
      };
      localStorage.setItem("animal-bluff-guest", JSON.stringify(cred));
      setCredentials(cred);
      setLobby(result.lobby);
      setView("lobby");
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : "", lang));
    } finally {
      setBusy(false);
    }
  }
  async function action(payload: unknown) {
    if (!credentials) return;
    if (realtimeRoom.current) {
      setBusy(true);
      setError("");
      try {
        realtimeRoom.current.send("action", {
          commandId: crypto.randomUUID(),
          action: payload,
        });
      } catch (e) {
        setBusy(false);
        setError(
          errorText(e instanceof Error ? e.message : "INTERNAL_ERROR", lang),
        );
      }
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request<{ state: Game; serverNow: number }>(
        `/api/rooms/${credentials.roomCode}/action`,
        {
          token: credentials.token,
          commandId: crypto.randomUUID(),
          action: payload,
        },
      );
      setServerClockOffsetMs(result.serverNow - Date.now());
      setGame(result.state);
      setSelectedCards([]);
      const snap = await request<{
        game: Game;
        log: LogEntry[];
        serverNow: number;
      }>(`/api/rooms/${credentials.roomCode}/snapshot`, {
        token: credentials.token,
      });
      setServerClockOffsetMs(snap.serverNow - Date.now());
      setGame(snap.game);
      setLog(snap.log);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : "", lang));
    } finally {
      setBusy(false);
    }
  }
  async function setReady(ready: boolean) {
    if (!credentials) return;
    try {
      await request(`/api/rooms/${credentials.roomCode}/ready`, {
        token: credentials.token,
        ready,
      });
      await loadRoom(credentials);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : "", lang));
    }
  }
  async function updateProfile() {
    if (!credentials) return;
    setBusy(true);
    setError("");
    try {
      const updated = await request<Lobby>(
        `/api/rooms/${credentials.roomCode}/profile`,
        { token: credentials.token, nickname, avatar },
      );
      setLobby(updated);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : "", lang));
    } finally {
      setBusy(false);
    }
  }
  async function startGame() {
    if (!credentials) return;
    setBusy(true);
    try {
      const result = await request<{ state: Game; serverNow: number }>(
        `/api/rooms/${credentials.roomCode}/start`,
        { token: credentials.token },
      );
      setServerClockOffsetMs(result.serverNow - Date.now());
      setGame(result.state);
      setView("starting");
      window.setTimeout(() => setView("game"), 1_400);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : "", lang));
    } finally {
      setBusy(false);
    }
  }
  const invite = credentials
    ? `${typeof window === "undefined" ? "" : window.location.origin}/?room=${credentials.roomCode}`
    : "";
  const filteredOfferValue =
    game?.ownMoney
      .filter((card) => selectedCards.includes(card.id))
      .reduce((sum, card) => sum + card.value, 0) ?? 0;
  function toggleCard(id: string) {
    setSelectedCards((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  return (
    <main
      className="app-shell"
      dir={rtl ? "rtl" : "ltr"}
      data-reduced-motion={reduceMotion}
      style={{ fontSize: `${textScale}%` }}
    >
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            setView("home");
            setError("");
          }}
          aria-label={t.title}
        >
          <span className="brand-mark">♞</span>
          <span>{t.title}</span>
        </button>
        <nav>
          <button onClick={() => setView("help")}>{t.help}</button>
          <button onClick={() => setView("settings")}>{t.settings}</button>
          <button
            className="language"
            onClick={() => setLang(rtl ? "en" : "ar")}
          >
            {rtl ? "English" : "العربية"}
          </button>
        </nav>
      </header>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {view === "home" && (
        <section className="home-grid">
          <div className="hero panel">
            <span className="eyebrow">CLASSIC KUHHANDEL · 3–5 PLAYERS</span>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
            <div className="animal-stamp" aria-hidden="true">
              🐴 / 🐮 / 🐷
            </div>
          </div>
          <section className="panel entry-card">
            <h2>{t.createTitle}</h2>
            <label>
              {t.nickname}
              <input
                value={nickname}
                maxLength={16}
                minLength={3}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={rtl ? "مثال: أمير" : "e.g. Amr"}
              />
            </label>
            <label>
              {t.avatar}
              <select
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
              >
                {avatars.map((a) => (
                  <option key={a} value={a}>
                    {animalIcon(a)} {avatarName(a, lang)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy || nickname.length < 3}
              onClick={() => void enter(true)}
            >
              {t.create}
            </button>
            <div className="divider">
              <span>OR</span>
            </div>
            <h2>{t.joinTitle}</h2>
            <label>
              {t.roomCode}
              <input
                value={roomInput}
                maxLength={6}
                onChange={(e) => setRoomInput(e.target.value.toUpperCase())}
                placeholder="ABC234"
              />
            </label>
            <button
              className="secondary"
              disabled={busy || nickname.length < 3 || roomInput.length !== 6}
              onClick={() => void enter(false)}
            >
              {t.join}
            </button>
          </section>
        </section>
      )}
      {view === "lobby" && lobby && credentials && (
        <section className="lobby-layout">
          <div className="panel lobby-main">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t.lobby}</span>
                <h1>{lobby.code}</h1>
              </div>
              <span className="status-pill">
                {lobby.playerCount}/{lobby.maxPlayers}
              </span>
            </div>
            <div className="share-box">
              <div>
                <strong>{t.share}</strong>
                <p>{invite}</p>
              </div>
              <div className="share-actions">
                <button
                  className="secondary"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(invite)
                      .then(() => setError(t.inviteCopied))
                  }
                >
                  {t.copy}
                </button>
                <Image
                  unoptimized
                  width={88}
                  height={88}
                  className="qr"
                  alt="Room invite QR code"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=112x112&data=${encodeURIComponent(invite)}`}
                />
              </div>
            </div>
            <h2>{t.players}</h2>
            <ul className="player-list">
              {lobby.players.map((p) => (
                <li key={p.id}>
                  <span
                    className="avatar"
                    aria-label={avatarName(p.avatar, lang)}
                  >
                    {animalIcon(p.avatar)}
                  </span>
                  <span className="player-name">
                    {p.nickname}
                    {p.id === lobby.host?.id && <small> · {t.host}</small>}
                    <small>
                      {p.status === "CONNECTED"
                        ? t.connected
                        : p.status === "FORFEITED"
                          ? t.forfeit
                          : p.status}
                    </small>
                  </span>
                  <span className={p.isReady ? "ready-tag" : "waiting-tag"}>
                    {p.isReady ? "✓" : "…"}
                  </span>
                  {isHost && p.id !== self && p.status !== "FORFEITED" && (
                    <button
                      className="small danger"
                      onClick={() => {
                        if (!window.confirm(t.confirmKick)) return;
                        void request(`/api/rooms/${lobby.code}/kick`, {
                          token: credentials.token,
                          targetId: p.id,
                        })
                          .then(() => loadRoom(credentials))
                          .catch((e) => setError(errorText(e.message, lang)));
                      }}
                    >
                      {t.kick}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="profile-editor">
              <label>
                {t.nickname}
                <input
                  value={nickname}
                  maxLength={16}
                  minLength={3}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </label>
              <label>
                {t.avatar}
                <select
                  value={avatar}
                  onChange={(event) => setAvatar(event.target.value)}
                >
                  {avatars.map((animal) => {
                    const taken = lobby.players.some(
                      (player) =>
                        player.id !== self &&
                        player.status !== "FORFEITED" &&
                        player.avatar === animal,
                    );
                    return (
                      <option key={animal} value={animal} disabled={taken}>
                        {animalIcon(animal)} {avatarName(animal, lang)}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button
                className="secondary"
                disabled={busy || nickname.length < 3}
                onClick={() => void updateProfile()}
              >
                {t.updateProfile}
              </button>
            </div>
            <div className="lobby-controls">
              <button
                className="secondary"
                onClick={() =>
                  void setReady(
                    !lobby.players.find((p) => p.id === self)?.isReady,
                  )
                }
              >
                {lobby.players.find((p) => p.id === self)?.isReady
                  ? t.unready
                  : t.ready}
              </button>
              {isHost && (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    lobby.playerCount < 3 ||
                    lobby.players.some(
                      (p) => p.status === "CONNECTED" && !p.isReady,
                    )
                  }
                  onClick={() => void startGame()}
                >
                  {t.start}
                </button>
              )}
              {isHost && (
                <button
                  className="text-danger"
                  onClick={() => {
                    if (!window.confirm(t.confirmClose)) return;
                    void request(`/api/rooms/${lobby.code}/close`, {
                      token: credentials.token,
                    })
                      .then(() => {
                        localStorage.removeItem("animal-bluff-guest");
                        setCredentials(null);
                        setView("home");
                      })
                      .catch((e) => setError(errorText(e.message, lang)));
                  }}
                >
                  {t.close}
                </button>
              )}
            </div>
            {lobby.playerCount < 3 && (
              <p className="muted">{t.playersNotReady}</p>
            )}
          </div>
          <aside className="panel side-note">
            <span className="eyebrow">30 MINUTES</span>
            <p>
              Lobby expiry:{" "}
              {new Date(lobby.lobbyExpiresAt).toLocaleTimeString(
                lang === "ar" ? "ar" : "en",
                { hour: "2-digit", minute: "2-digit" },
              )}
            </p>
            <p>{t.waiting}</p>
          </aside>
        </section>
      )}
      {view === "starting" && game && (
        <section
          className="panel content-panel game-starting"
          aria-live="polite"
        >
          <span className="eyebrow">{t.game}</span>
          <h1>{t.shuffling}</h1>
          <p>
            {t.firstPlayer}:{" "}
            {
              game.players.find((player) => player.id === game.firstPlayerId)
                ?.nickname
            }
          </p>
          <ol className="starting-order">
            {game.players.map((player, index) => (
              <li key={player.id}>
                <span>{index + 1}.</span> {animalIcon(player.avatar)}{" "}
                {player.nickname}
                {player.id === game.firstPlayerId ? " ★" : ""}
              </li>
            ))}
          </ol>
        </section>
      )}
      {view === "game" && game && credentials && (
        <section className="game-layout">
          <div className="game-board panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {t.game} · {game.phase}
                </span>
                <h1>
                  {game.phase === "COMPLETED" ||
                  game.phase === "ENDED_NO_RESULT"
                    ? t.results
                    : game.currentPlayerId === self
                      ? t.turn
                      : t.waitingTurn}
                </h1>
              </div>
              <div className="button-row">
                <span className="status-pill">
                  {game.animals.filter((a) => a.ownerId === null).length} cards
                  left
                </span>
                {remainingSeconds !== null && (
                  <span
                    className={`timer-pill ${auctionEndingSoon || deadlineSoon ? "timer-urgent" : ""}`}
                    aria-live="polite"
                  >
                    {auctionEndingSoon
                      ? t.auctionEndingSoon
                      : deadlineSoon
                        ? t.deadlineSoon
                        : null}{" "}
                    {remainingSeconds}s
                  </span>
                )}
              </div>
            </div>
            <div className="table-players">
              {game.players.map((p) => (
                <article
                  className={`seat ${p.id === game.currentPlayerId ? "active-seat" : ""}`}
                  key={p.id}
                >
                  <span
                    className="avatar"
                    aria-label={avatarName(p.avatar, lang)}
                  >
                    {animalIcon(p.avatar)}
                  </span>
                  <strong>
                    {p.nickname}
                    {p.id === self ? " (you)" : ""}
                  </strong>
                  <small>
                    {game.animals.filter((a) => a.ownerId === p.id).length}{" "}
                    animals
                  </small>
                </article>
              ))}
            </div>
            {game.phase === "RULE_DECISION_REQUIRED" && (
              <div className="notice error">{t.waitingDecision}</div>
            )}
            {game.phase === "ENDED_NO_RESULT" && (
              <div className="notice">{t.noResult}</div>
            )}
            {game.phase === "TURN" &&
              game.currentPlayerId === self &&
              game.animals.some((a) => a.ownerId === null) && (
                <button
                  className="primary action-button"
                  disabled={busy}
                  onClick={() => void action({ type: "startAuction" })}
                >
                  {t.auction}
                </button>
              )}
            {game.phase === "TURN" &&
              game.currentPlayerId === self &&
              eligibleTradeTypes.length > 0 && (
                <div className="trade-controls">
                  <h2>{t.trade}</h2>
                  <div className="button-row">
                    <select
                      value={selectedTradeAnimal}
                      onChange={(e) => {
                        setTradeAnimal(e.target.value);
                        setTradeTarget("");
                      }}
                    >
                      {eligibleTradeTypes.map((animal) => (
                        <option key={animal} value={animal}>
                          {animalIcon(animal)} {avatarName(animal, lang)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={
                        eligibleTradeTargets.some(
                          (player) => player.id === tradeTarget,
                        )
                          ? tradeTarget
                          : ""
                      }
                      onChange={(e) => setTradeTarget(e.target.value)}
                    >
                      <option value="">{t.target}</option>
                      {eligibleTradeTargets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nickname}
                        </option>
                      ))}
                    </select>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !eligibleTradeTargets.some(
                          (player) => player.id === tradeTarget,
                        )
                      }
                      onClick={() =>
                        void action({
                          type: "initiateTrade",
                          animalType: selectedTradeAnimal,
                          targetId: tradeTarget,
                          moneyCardIds: selectedCards,
                        })
                      }
                    >
                      {t.makeOffer}
                    </button>
                  </div>
                </div>
              )}
            {game.phase === "AUCTION" && game.auction && (
              <div className="action-panel">
                <h2>
                  {animalIcon(
                    game.animals.find(
                      (card) => card.id === game.auction!.animalCardId,
                    )?.type ?? "",
                  )}{" "}
                  {avatarName(
                    game.animals.find(
                      (card) => card.id === game.auction!.animalCardId,
                    )?.type ?? "",
                    lang,
                  )}
                </h2>
                <p>
                  {t.auction}:{" "}
                  {
                    game.players.find(
                      (p) => p.id === game.auction!.auctioneerId,
                    )?.nickname
                  }
                </p>
                <p>
                  {t.highBidder}:{" "}
                  {game.auction.highBidderId
                    ? game.players.find(
                        (p) => p.id === game.auction!.highBidderId,
                      )?.nickname
                    : "—"}
                  {" · "}
                  {t.amount}: {game.auction.highBid || "—"}
                </p>
                {game.auction.auctioneerId !== self && (
                  <>
                    <p>
                      {t.minimumBid}:{" "}
                      {game.auction.highBid ? game.auction.highBid + 10 : 1}
                    </p>
                    <div className="quick-bids">
                      <span>{t.quickBid}</span>
                      {[10, 20, 50, 100].map((increment) => (
                        <button
                          key={increment}
                          className="small secondary"
                          onClick={() =>
                            setBid(game.auction!.highBid + increment)
                          }
                        >
                          +{increment}
                        </button>
                      ))}
                    </div>
                    <div className="button-row">
                      <input
                        type="number"
                        min={
                          game.auction.highBid ? game.auction.highBid + 10 : 1
                        }
                        value={bid}
                        onChange={(e) => setBid(Number(e.target.value))}
                        aria-label={t.bid}
                      />
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          bid <
                            (game.auction.highBid
                              ? game.auction.highBid + 10
                              : 1)
                        }
                        onClick={() =>
                          void action({ type: "bid", amount: bid })
                        }
                      >
                        {t.placeBid}
                      </button>
                    </div>
                  </>
                )}
                <h3>{t.bidHistory}</h3>
                <ol className="bid-history">
                  {log
                    .filter((event) => event.eventType === "AUCTION_STARTED")
                    .at(-1)
                    ? log
                        .filter(
                          (event) =>
                            event.sequence >
                              (log
                                .filter(
                                  (item) =>
                                    item.eventType === "AUCTION_STARTED",
                                )
                                .at(-1)?.sequence ?? 0) &&
                            event.eventType === "BID_ACCEPTED",
                        )
                        .reverse()
                        .map((event) => (
                          <li key={event.sequence}>
                            {
                              game.players.find(
                                (p) => p.id === event.actorPlayerId,
                              )?.nickname
                            }
                            : {event.amount}
                          </li>
                        ))
                    : null}
                </ol>
              </div>
            )}
            {game.phase === "AUCTIONEER_CHOICE" && game.auction && (
              <div className="action-panel">
                <p>
                  {
                    game.players.find(
                      (player) => player.id === game.auction!.highBidderId,
                    )?.nickname
                  }
                  {" · "}
                  {t.amount}: {game.auction.highBid}
                </p>
                {game.auction.auctioneerId === self && (
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void action({ type: "chooseAuctioneer", choice: "BUY" })
                      }
                    >
                      {t.buy}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action({
                          type: "chooseAuctioneer",
                          choice: "PASS",
                        })
                      }
                    >
                      {t.pass}
                    </button>
                  </div>
                )}
              </div>
            )}
            {game.phase === "PAYMENT" && game.auction && (
              <div className="action-panel">
                <p>{t.pay}</p>
                <p>
                  {
                    game.players.find(
                      (player) => player.id === game.auction!.payerId,
                    )?.nickname
                  }
                  {" → "}
                  {
                    game.players.find(
                      (player) => player.id === game.auction!.payeeId,
                    )?.nickname
                  }
                  {" · "}
                  {t.amount}: {game.auction.due}
                </p>
                {game.auction.payerId === self && (
                  <>
                    <p>
                      {t.amount}: {filteredOfferValue} / {game.auction.due}
                      {filteredOfferValue > game.auction.due &&
                        ` · ${t.noChange}`}
                    </p>
                    {filteredOfferValue < game.auction.due && (
                      <p className="notice error">{t.paymentShort}</p>
                    )}
                    <button
                      className="primary"
                      disabled={busy || filteredOfferValue < game.auction.due}
                      onClick={() =>
                        void action({
                          type: "confirmPayment",
                          moneyCardIds: selectedCards,
                        })
                      }
                    >
                      {t.confirm}
                    </button>
                  </>
                )}
              </div>
            )}
            {game.phase === "NEGOTIATION" && game.negotiation && (
              <div className="action-panel">
                <p>
                  {t.challenger}:{" "}
                  {
                    game.players.find(
                      (player) => player.id === game.negotiation!.challengerId,
                    )?.nickname
                  }
                  {" · "}
                  {t.challenged}:{" "}
                  {
                    game.players.find(
                      (player) => player.id === game.negotiation!.targetId,
                    )?.nickname
                  }
                </p>
                <p>
                  {animalIcon(game.negotiation.animalType)}{" "}
                  {avatarName(game.negotiation.animalType, lang)} ×{" "}
                  {game.negotiation.cardCount}
                </p>
                <p>
                  {t.initialOffer}:{" "}
                  {game.negotiation.firstOfferValues.length
                    ? game.negotiation.firstOfferValues.join(", ")
                    : t.emptyOffer}
                  {" · "}
                  {t.amount}: {game.negotiation.firstOfferTotal}
                </p>
                {game.negotiation.targetId === self ? (
                  <div className="button-row">
                    <span>
                      {t.amount}: {filteredOfferValue}
                    </span>
                    <button
                      className="primary"
                      onClick={() =>
                        void action({
                          type: "respondTrade",
                          response: "ACCEPT",
                        })
                      }
                    >
                      {t.accept}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action({
                          type: "respondTrade",
                          response: "COUNTER",
                          moneyCardIds: selectedCards,
                        })
                      }
                    >
                      {t.counter}
                    </button>
                  </div>
                ) : (
                  <p>{t.waiting}</p>
                )}
              </div>
            )}
            {game.publicReveal && (
              <div className="notice">
                {
                  game.players.find((p) => p.id === game.publicReveal!.playerId)
                    ?.nickname
                }
                : {game.publicReveal.denominations.join(", ")}
              </div>
            )}
            {game.results.length > 0 && (
              <div className="results-grid">
                <h2>{t.results}</h2>
                <p className="notice">
                  {game.results.filter((result) => result.isWinner).length > 1
                    ? t.sharedVictory
                    : t.winner}
                  {": "}
                  {game.results
                    .filter((result) => result.isWinner)
                    .map(
                      (result) =>
                        game.players.find(
                          (player) => player.id === result.playerId,
                        )?.nickname,
                    )
                    .join(" · ")}{" "}
                  🏆
                </p>
                <div className="button-row result-actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      document
                        .getElementById("public-game-log")
                        ?.scrollIntoView({
                          behavior: reduceMotion ? "instant" : "smooth",
                        })
                    }
                  >
                    {t.viewLog}
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      document
                        .getElementById("match-statistics")
                        ?.scrollIntoView({
                          behavior: reduceMotion ? "instant" : "smooth",
                        })
                    }
                  >
                    {t.statistics}
                  </button>
                  <button className="secondary" onClick={() => setView("home")}>
                    {t.backHome}
                  </button>
                </div>
                {[...game.results]
                  .sort((a, b) => b.score - a.score)
                  .map((result, _index, ranked) => {
                    const player = game.players.find(
                      (candidate) => candidate.id === result.playerId,
                    );
                    const rank =
                      ranked.findIndex(
                        (candidate) => candidate.score === result.score,
                      ) + 1;
                    return (
                      <article className="result-row" key={result.playerId}>
                        <span>{rank}.</span>
                        <span
                          className="avatar"
                          aria-label={avatarName(player?.avatar ?? "", lang)}
                        >
                          {animalIcon(player?.avatar ?? "")}
                        </span>
                        <div>
                          <strong>{player?.nickname}</strong>
                          <p>
                            {t.completedQuartets}: {result.quartetCount} ·{" "}
                            {t.quartetValueSum}: {result.quartetValueSum}
                          </p>
                          <p>
                            {result.quartetValueSum} × {result.quartetCount} ={" "}
                            {result.score}
                            {result.isWinner ? " 🏆" : ""}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                {statistics && (
                  <section className="match-statistics" id="match-statistics">
                    <h3>{t.statistics}</h3>
                    {statistics.map((stat) => (
                      <article key={stat.player.id}>
                        <strong>{stat.player.nickname}</strong>
                        <p>
                          {t.auctionsPlayed}: {stat.auctionsPlayed} ·{" "}
                          {t.auctionsWon}: {stat.auctionsWon}
                        </p>
                        <p>
                          {t.tradesWon}: {stat.tradesWon} · {t.duration}:{" "}
                          {Math.floor(stat.durationMs / 60000)}m{" "}
                          {Math.floor((stat.durationMs % 60000) / 1000)}s
                        </p>
                        <p>
                          {t.completedQuartets}: {stat.quartetCount} ·{" "}
                          {t.quartetValueSum}: {stat.quartetValueSum}
                        </p>
                      </article>
                    ))}
                  </section>
                )}
              </div>
            )}
            <div className="collection-heading">
              <div>
                <span className="eyebrow">{t.game}</span>
                <h2>{t.animalsOwned}</h2>
              </div>
              <span className="status-pill">
                {game.animals.filter((card) => card.ownerId === self).length}{" "}
                {t.animalCards}
              </span>
            </div>
            {game.players.map((player) => (
              <section className="player-collection" key={player.id}>
                <h3>
                  {player.nickname}
                  {player.id === self && (
                    <span className="you-tag">
                      {lang === "ar" ? "أنت" : "You"}
                    </span>
                  )}
                </h3>
                <div className="collection">
                  {animals.map((animal) => {
                    const cards = game.animals.filter(
                      (card) =>
                        card.ownerId === player.id && card.type === animal,
                    );
                    return (
                      <details
                        key={`${player.id}-${animal}`}
                        className={`animal-card-group ${cards.length === 4 ? "quartet" : cards.length ? "has-animals" : "empty-animal"}`}
                      >
                        <summary>
                          <span className="animal-card-art" aria-hidden="true">
                            {animalIcon(animal)}
                          </span>
                          <span className="animal-card-info">
                            <strong>{avatarName(animal, lang)}</strong>
                            <small>
                              {values[animal]}{" "}
                              {lang === "ar"
                                ? "قيمة الرباعية"
                                : "quartet value"}
                            </small>
                          </span>
                          <span className="animal-count">{cards.length}/4</span>
                        </summary>
                        <div className="animal-card-details">
                          {cards.length ? (
                            <div
                              className="mini-card-row"
                              aria-label={`${cards.length} ${avatarName(animal, lang)} cards`}
                            >
                              {cards.map((card) => (
                                <span
                                  className="mini-animal-card"
                                  key={card.id}
                                  aria-hidden="true"
                                >
                                  {animalIcon(animal)}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <small className="muted">{t.emptySet}</small>
                          )}
                          {cards.map((card) => (
                            <small className="animal-card-id" key={card.id}>
                              {card.acquisitionSource && (
                                <span>
                                  {" · "}
                                  {card.acquisitionSource === "AUCTION"
                                    ? t.auctionSource
                                    : t.tradeSource}
                                </span>
                              )}
                              {card.acquiredAt && (
                                <span>
                                  {" · "}
                                  {t.acquired}:{" "}
                                  {new Date(card.acquiredAt).toLocaleString(
                                    lang,
                                  )}
                                </span>
                              )}
                              {card.previousOwnerId && (
                                <span>
                                  {" · "}
                                  {t.previousOwner}:{" "}
                                  {game.players.find(
                                    (p) => p.id === card.previousOwnerId,
                                  )?.nickname ?? "—"}
                                </span>
                              )}
                            </small>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <aside className="panel hand-panel">
            <div className="hand-heading">
              <div>
                <span className="eyebrow">
                  {lang === "ar" ? "أوراقك الخاصة" : "PRIVATE HAND"}
                </span>
                <h2>{t.myCards}</h2>
              </div>
              <span className="hand-total">
                {game.ownMoney.reduce((sum, card) => sum + card.value, 0)}
                <small>{t.amount}</small>
              </span>
            </div>
            <p className="hand-hint">
              {lang === "ar"
                ? "اختر الأوراق عند الدفع أو تقديم عرض."
                : "Select cards when paying or making an offer."}
            </p>
            {selectedCards.length > 0 && (
              <div className="selection-summary" aria-live="polite">
                <span>
                  {selectedCards.length} {t.selected} · {filteredOfferValue}{" "}
                  {t.amount}
                </span>
                <button
                  type="button"
                  className="clear-selection"
                  onClick={() => setSelectedCards([])}
                >
                  {t.clearSelection}
                </button>
              </div>
            )}
            <div className="money-cards">
              {game.ownMoney.map((card) => (
                <button
                  key={card.id}
                  className={`money-card ${selectedCards.includes(card.id) ? "selected-card" : ""}`}
                  aria-pressed={selectedCards.includes(card.id)}
                  aria-label={`${card.value} ${lang === "ar" ? "ورقة مال" : "money card"}${selectedCards.includes(card.id) ? `, ${lang === "ar" ? "محدد" : "selected"}` : ""}`}
                  onClick={() => toggleCard(card.id)}
                >
                  <span className="money-card-corner" aria-hidden="true">
                    ✦
                  </span>
                  <strong>{card.value}</strong>
                  <small>{lang === "ar" ? "مال" : "MONEY"}</small>
                </button>
              ))}
            </div>
            <h2 id="public-game-log">{t.log}</h2>
            <div className="log-filters">
              <select
                value={filterActor}
                onChange={(e) => setFilterActor(e.target.value)}
              >
                <option value="">{t.players}</option>
                {game.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nickname}
                  </option>
                ))}
              </select>
              <select
                value={filterEvent}
                onChange={(e) => setFilterEvent(e.target.value)}
              >
                <option value="">All events</option>
                {[...new Set(log.map((e) => e.eventType))].map((event) => (
                  <option key={event}>{event}</option>
                ))}
              </select>
            </div>
            <ol className="event-log">
              {filteredLog.map((e) => (
                <li key={e.sequence}>
                  <small>
                    {new Date(e.occurredAt).toLocaleTimeString(
                      lang === "ar" ? "ar" : "en",
                    )}
                  </small>
                  <span>
                    {e.eventType.replaceAll("_", " ")} {e.animalType ?? ""}{" "}
                    {e.amount ?? e.submittedMoneyValue ?? ""}{" "}
                    {e.submittedMoneyDenominations.length
                      ? `[${e.submittedMoneyDenominations.join(", ")}]`
                      : ""}
                  </span>
                </li>
              ))}
              {!filteredLog.length && <li>{t.noLog}</li>}
            </ol>
          </aside>
        </section>
      )}
      {view === "help" && (
        <section className="panel content-panel">
          <span className="eyebrow">{t.help}</span>
          <h1>{t.title}</h1>
          {helpSections[lang].map((section, index) => (
            <article className="help-section" key={section.title}>
              <h2>{section.title}</h2>
              <p>{section.body}</p>
              {index === 2 && (
                <ol
                  className="help-illustration"
                  aria-label={
                    lang === "ar" ? "مثال مرئي للمزاد" : "Auction example"
                  }
                >
                  <li>
                    <strong>
                      {animalIcon("COW")} {avatarName("COW", lang)}
                    </strong>
                    <span>
                      {lang === "ar" ? "تُكشف للمزاد" : "Revealed for auction"}
                    </span>
                  </li>
                  <li>
                    <strong>30 → 40</strong>
                    <span>
                      {lang === "ar" ? "مزايدة مقبولة" : "Accepted bids"}
                    </span>
                  </li>
                  <li>
                    <strong>50</strong>
                    <span>
                      {lang === "ar"
                        ? "أوراق دفع؛ لا يُعاد الباقي"
                        : "Paid in cards; no change"}
                    </span>
                  </li>
                </ol>
              )}
              {index === 4 && (
                <ol
                  className="help-illustration"
                  aria-label={
                    lang === "ar" ? "مثال مرئي للمقايضة" : "Kuhhandel example"
                  }
                >
                  <li>
                    <strong>{animalIcon("HORSE")} × 2</strong>
                    <span>
                      {lang === "ar" ? "لكل لاعب زوج" : "A pair per player"}
                    </span>
                  </li>
                  <li>
                    <strong>30 ↔ 40</strong>
                    <span>
                      {lang === "ar"
                        ? "عرض وعرض مضاد"
                        : "Offer and counteroffer"}
                    </span>
                  </li>
                  <li>
                    <strong>{animalIcon("HORSE")} × 2</strong>
                    <span>
                      {lang === "ar"
                        ? "صاحب العرض الأعلى يأخذ الزوج"
                        : "Higher offer takes the pair"}
                    </span>
                  </li>
                </ol>
              )}
            </article>
          ))}
          <button
            className="secondary"
            onClick={() =>
              setView(credentials ? (game ? "game" : "lobby") : "home")
            }
          >
            {t.back}
          </button>
        </section>
      )}
      {view === "settings" && (
        <section className="panel content-panel">
          <span className="eyebrow">{t.settings}</span>
          <h1>{t.settings}</h1>
          <label className="setting-row">
            {t.language}
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Language)}
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </select>
          </label>
          <label className="setting-row">
            {t.sound}
            <input
              type="checkbox"
              checked={soundEffects}
              onChange={(e) => setSoundEffects(e.target.checked)}
            />
          </label>
          <label className="setting-row">
            {t.backgroundMusic}
            <input
              type="checkbox"
              checked={backgroundMusic}
              onChange={(e) => setBackgroundMusic(e.target.checked)}
            />
          </label>
          <label className="setting-row">
            {t.notificationsSound}
            <input
              type="checkbox"
              checked={notificationSound}
              onChange={(event) => setNotificationSound(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            {t.volume}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
            <output>{volume}%</output>
          </label>
          <label className="setting-row">
            {t.reduceMotion}
            <input
              type="checkbox"
              checked={reduceMotion}
              onChange={(event) => setReduceMotion(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            {t.textSize}
            <input
              type="range"
              min={85}
              max={130}
              step={5}
              value={textScale}
              onChange={(event) => setTextScale(Number(event.target.value))}
            />
            <output>{textScale}%</output>
          </label>
          <h2>{t.localProfile}</h2>
          <label className="setting-row">
            {t.nickname}
            <input
              value={nickname}
              maxLength={16}
              minLength={3}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          <label className="setting-row">
            {t.avatar}
            <select
              value={avatar}
              onChange={(event) => setAvatar(event.target.value)}
            >
              {avatars.map((animal) => (
                <option key={animal} value={animal}>
                  {animalIcon(animal)} {avatarName(animal, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            {t.profileColor}
            <select
              value={profileAccent}
              onChange={(event) =>
                setProfileAccent(event.target.value as ProfileAccent)
              }
            >
              <option value="sage">{t.accentSage}</option>
              <option value="sunshine">{t.accentSunshine}</option>
              <option value="terracotta">{t.accentTerracotta}</option>
            </select>
            <span
              className="avatar profile-preview"
              data-accent={profileAccent}
            >
              {animalIcon(avatar)}
            </span>
          </label>
          <button
            className="secondary"
            onClick={() =>
              setView(credentials ? (game ? "game" : "lobby") : "home")
            }
          >
            {t.back}
          </button>
        </section>
      )}
      <footer>
        <span>Animal Bluff · Classic edition</span>
        <span>40 animals · 55 money cards · 3–5 players</span>
      </footer>
    </main>
  );
}
