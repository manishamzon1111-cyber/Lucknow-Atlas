export const TYPES = {
  HERITAGE_WALK: "heritage_walk",
  EXHIBITION: "exhibition",
  FESTIVAL: "festival",
  MONUMENT_CLOSURE: "monument_closure",
  MUSEUM_NOTICE: "museum_notice",
  TRAFFIC_DIVERSION: "traffic_diversion",
  TIMING_CHANGE: "timing_change"
};

export const PRIORITY = {
  MANUAL: 0,
  BHATKHANDE: 1,
  LUCKNOW_NIC: 1,
  NEWS: 3
};

export const TTL_DAYS = {
  heritage_walk: 14,
  exhibition: 14,
  festival: 14,
  monument_closure: 21,
  museum_notice: 21,
  traffic_diversion: 3,
  timing_change: 21
};

export const HARD_BLOCK = [
  "admission",
  "admit card",
  "counselling",
  "counseling",
  "examination",
  "exam ",
  "exam-",
  "result",
  "recruitment",
  "vacancy",
  "appointment",
  "interview",
  "tender",
  "quotation",
  "hostel",
  "semester",
  "syllabus",
  "fee ",
  "scholarship",
  "attendance",
  "election",
  "court",
  "judgment",
  "judgement",
  "audit",
  "convocation",
  "time table",
  "timetable",
  "id card",
  "backpaper",
  "application form",
  "guest faculty",
  "subject expert",
  "guest accompanist",
  "special train",
  "special trains",
  "railway recruitment",
  "job fair",
  "rojgar",
  "sports competition",
  "sports meet",
  "tournament",
  "brunch",
  "staycation",
  "hotel offer",
  "restaurant offer",
  "shopping",
  "where to buy",
  "discount",
  "% off",
  "sale ",
  "anniversary offer",
  "staycation",
  "brunch",
  "social is turning"
];

export const CATEGORY_TERMS = {
  heritage_walk: [
    "heritage walk",
    "city walk",
    "food walk",
    "walking tour"
  ],

  exhibition: [
    "exhibition",
    "art exhibition",
    "art show",
    "gallery show"
  ],

  festival: [
    "festival",
    "mahotsav",
    "mushaira",
    "concert",
    "cultural programme",
    "cultural program",
    "cultural evening",
    "samaroh",
    "book fair",
    "book festival"
  ],

  monument_closure: [
    "monument closed",
    "closed for restoration",
    "closure",
    "restricted access",
    "restoration",
    "renovation",
    "conservation work"
  ],

  museum_notice: [
    "state museum",
    "museum event"
  ],

  traffic_diversion: [
    "traffic diversion",
    "traffic advisory",
    "route diversion",
    "route diverted",
    "no entry",
    "road closed"
  ],

  timing_change: [
    "timing change",
    "new timings",
    "revised timings",
    "opening hours",
    "revised hours"
  ]
};

export const VENUES = {
  "gomti book festival": "gomti-book-festival",

  "bara imambara": "bara-imambara",
  "bada imambara": "bara-imambara",

  "chota imambara": "chota-imambara",
  "chhota imambara": "chota-imambara",

  "rumi darwaza": "rumi-darwaza",
  "roomi gate": "rumi-darwaza",

  "british residency": "residency",
  "lucknow residency": "residency",

  "state museum": "state-museum",

  "bhatkhande": "bhatkhande",

  "sanatkada": "sanatkada",

  "husainabad": "husainabad",
  "hussainabad": "husainabad",

  "hazratganj": "hazratganj",
  "chowk": "chowk",

  "kaiserbagh": "kaiserbagh",
  "qaiserbagh": "kaiserbagh",

  "dilkusha": "dilkusha",

  "safed baradari": "safed-baradari",

  "picture gallery": "picture-gallery",

  "shaheed smarak": "shaheed-smarak",

  "kukrail": "kukrail"
};

export const LUCKNOW_TERMS = [
  "lucknow",
  "gomti",
  "hazratganj",
  "aminabad",
  "chowk",
  "kaiserbagh",
  "qaiserbagh",
  "husainabad",
  "hussainabad",
  "bara imambara",
  "bada imambara",
  "chota imambara",
  "chhota imambara",
  "rumi darwaza",
  "roomi gate",
  "british residency",
  "lucknow residency",
  "state museum",
  "bhatkhande",
  "sanatkada",
  "safed baradari",
  "dilkusha",
  "kukrail"
];
