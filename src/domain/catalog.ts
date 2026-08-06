export const worlds = [
  { id: "story-forest", name: "이야기숲", description: "토리와 만나는 포근한 숲", recommendedAges: [3, 7], promptKeywords: ["warm enchanted forest", "acorn fairy"], compatibleLessonIds: ["COURAGE", "KINDNESS", "HONESTY", "SELF_CONTROL"], compatibleToneIds: ["WARM", "PLAYFUL", "CALM"] },
  { id: "dinosaur-island", name: "공룡섬", description: "친절한 공룡들이 사는 모험의 섬", recommendedAges: [4, 7], promptKeywords: ["friendly dinosaurs", "lush island"], compatibleLessonIds: ["COURAGE", "KINDNESS"], compatibleToneIds: ["WARM", "ADVENTUROUS"] },
  { id: "space-village", name: "우주마을", description: "별 사이에 떠 있는 신비한 마을", recommendedAges: [5, 7], promptKeywords: ["friendly space village", "colorful planets"], compatibleLessonIds: ["COURAGE", "HONESTY"], compatibleToneIds: ["PLAYFUL", "ADVENTUROUS"] },
  { id: "undersea-kingdom", name: "바닷속왕국", description: "물고기 친구들과 배우는 바닷속 세상", recommendedAges: [3, 7], promptKeywords: ["gentle underwater kingdom", "friendly fish"], compatibleLessonIds: ["KINDNESS", "SELF_CONTROL"], compatibleToneIds: ["WARM", "CALM"] },
  { id: "cloud-station", name: "구름기차역", description: "감정을 싣고 달리는 구름 기차", recommendedAges: [3, 7], promptKeywords: ["cloud train station", "pastel sky"], compatibleLessonIds: ["COURAGE", "SELF_CONTROL"], compatibleToneIds: ["WARM", "CALM"] },
];

export const illustrationStyles = [
  { id: "WATERCOLOR", name: "수채화", description: "부드럽고 투명한 수채화", prompt: "soft Korean children's book watercolor", previewUrl: null },
  { id: "COLORED_PENCIL", name: "색연필", description: "따뜻한 손그림 색연필", prompt: "warm colored pencil children's illustration", previewUrl: null },
  { id: "CLAY_3D", name: "클레이 3D", description: "말랑하고 귀여운 점토 인형", prompt: "cute handcrafted clay 3D diorama", previewUrl: null },
];

export const tags = [
  { id: "DINOSAUR", group: "INTEREST", name: "공룡", compatibleWorldIds: ["dinosaur-island", "story-forest"] },
  { id: "TRAIN", group: "INTEREST", name: "기차", compatibleWorldIds: ["cloud-station"] },
  { id: "WORRY", group: "EMOTION", name: "걱정", compatibleWorldIds: worlds.map((x) => x.id) },
  { id: "FIRST_SCHOOL", group: "SITUATION", name: "첫 등원", compatibleWorldIds: worlds.map((x) => x.id) },
  { id: "NEW_SIBLING", group: "SITUATION", name: "동생 출생", compatibleWorldIds: worlds.map((x) => x.id) },
  { id: "PICKY_EATING", group: "SITUATION", name: "편식", compatibleWorldIds: worlds.map((x) => x.id) },
  { id: "MOVING", group: "SITUATION", name: "이사", compatibleWorldIds: worlds.map((x) => x.id) },
  { id: "COURAGE", group: "LESSON", name: "용기", compatibleWorldIds: worlds.filter((x) => x.compatibleLessonIds.includes("COURAGE")).map((x) => x.id) },
  { id: "KINDNESS", group: "LESSON", name: "배려", compatibleWorldIds: worlds.filter((x) => x.compatibleLessonIds.includes("KINDNESS")).map((x) => x.id) },
  { id: "HONESTY", group: "LESSON", name: "정직", compatibleWorldIds: worlds.filter((x) => x.compatibleLessonIds.includes("HONESTY")).map((x) => x.id) },
  { id: "SELF_CONTROL", group: "LESSON", name: "절제", compatibleWorldIds: worlds.filter((x) => x.compatibleLessonIds.includes("SELF_CONTROL")).map((x) => x.id) },
  { id: "WARM", group: "TONE", name: "따뜻하게", compatibleWorldIds: worlds.filter((x) => x.compatibleToneIds.includes("WARM")).map((x) => x.id) },
  { id: "NO_SCARY", group: "NEGATIVE", name: "무서운 장면 제외", compatibleWorldIds: worlds.map((x) => x.id) },
];

export const billingPlans = [
  { id: "DIGITAL_MONTHLY", name: "디지털 월 구독", price: 9900, currency: "KRW", interval: "MONTH", storiesPerPeriod: 1 },
  { id: "HARDCOVER", name: "양장본", price: 39000, subscriberPrice: 29000, currency: "KRW", interval: null },
  { id: "GIFT_PACKAGE", name: "선물 패키지", price: 59000, currency: "KRW", interval: null },
];

export const products = [
  { id: "HARDCOVER", name: "맞춤 동화 양장본", description: "구매한 동화를 양장본으로 제작", price: 39000, subscriberPrice: 29000, options: ["coverMessage"], active: true },
  { id: "GIFT_PACKAGE", name: "도토리 선물 패키지", description: "양장본, 선물 포장, 토리 인형 키링, 메시지 카드", price: 59000, subscriberPrice: null, options: ["giftMessage"], active: true },
  { id: "TORI_KEYRING", name: "토리 인형 키링", description: "도토리 요정 토리 키링", price: 12000, subscriberPrice: null, options: [], active: true },
];

