// Original sample catalog. All copy is written for this project; it is placeholder
// merchandise, flagged is_demo in the database, and makes no health or medical claims.

export interface SeedVariant {
  name: string;
  price: number; // rupees
  compareAt?: number;
}

export interface SeedProduct {
  title: string;
  sub: string;
  tags: string[];
  price: number; // rupees, default variant
  compareAt?: number;
  attrs: Record<string, string>;
  blurb: string;
  variants?: SeedVariant[];
  newDaysAgo?: number; // created_at offset; small = new arrival
}

export interface SeedCategory {
  slug: string;
  name: string;
  description: string;
  subcategories: string[];
  products: SeedProduct[];
}

const sizes = (base: number, compareAt?: number): SeedVariant[] =>
  ['S', 'M', 'L', 'XL'].map((s, i) => ({ name: s, price: base + (i > 2 ? 100 : 0), compareAt }));

export const catalog: SeedCategory[] = [
  {
    slug: 'rudraksha',
    name: 'Rudraksha',
    description: 'Hand-strung beads and malas, knotted on cotton or silk thread.',
    subcategories: ['Malas', 'Bracelets', 'Single Beads', 'Care'],
    products: [
      { title: 'Five-Faced Rudraksha Mala, 108 Beads', sub: 'Malas', tags: ['mala', 'cotton thread', 'daily wear', 'gifting'], price: 2450, compareAt: 2800, attrs: { material: 'Rudraksha, cotton thread', beadSize: '6 mm', length: '84 cm' }, blurb: 'A full-length mala with evenly matched beads, knotted between each bead so the strand drapes softly.', variants: [{ name: '6 mm beads', price: 2450, compareAt: 2800 }, { name: '8 mm beads', price: 3150 }] },
      { title: 'Rudraksha Wrist Mala on Silk', sub: 'Bracelets', tags: ['bracelet', 'silk thread', 'daily wear'], price: 890, attrs: { material: 'Rudraksha, silk thread', beads: '27', closure: 'Sliding knot' }, blurb: 'Twenty-seven beads on a sliding silk knot that adjusts to most wrists.' },
      { title: 'Single Rudraksha Bead Pendant', sub: 'Single Beads', tags: ['pendant', 'cotton thread', 'minimal'], price: 450, attrs: { material: 'Rudraksha, cotton cord', beadSize: '10 mm' }, blurb: 'One substantial bead on a black cotton cord, for those who prefer something understated.' },
      { title: 'Rudraksha and Sandalwood Bracelet', sub: 'Bracelets', tags: ['bracelet', 'sandalwood', 'gifting'], price: 1190, compareAt: 1390, attrs: { material: 'Rudraksha, sandalwood, elastic cord' }, blurb: 'Alternating rudraksha and lightly scented sandalwood beads on a durable stretch cord.', newDaysAgo: 6 },
      { title: 'Panchamukhi Bead Set for Children', sub: 'Single Beads', tags: ['children', 'pendant', 'cotton thread'], price: 520, attrs: { material: 'Rudraksha, cotton thread', beadSize: '5 mm' }, blurb: 'A small, lightweight bead on a soft thread sized for young wearers.' },
      { title: 'Mala Care Oil, Sesame Base', sub: 'Care', tags: ['care', 'sesame oil', 'maintenance'], price: 290, attrs: { volume: '30 ml', base: 'Cold-pressed sesame oil' }, blurb: 'A light sesame-based oil for conditioning beads that have dried out with regular wear.' },
      { title: 'Rudraksha Mala with Copper Spacers', sub: 'Malas', tags: ['mala', 'copper', 'cotton thread'], price: 3290, attrs: { material: 'Rudraksha, copper, cotton thread', length: '80 cm' }, blurb: 'Hand-turned copper spacers break the strand into even sections of twelve beads.', newDaysAgo: 3 },
      { title: 'Travel Pouch for Malas', sub: 'Care', tags: ['care', 'pouch', 'cotton', 'travel'], price: 240, attrs: { material: 'Handloom cotton', size: '12 x 15 cm' }, blurb: 'A drawstring handloom pouch that keeps a mala untangled in a bag.' },
    ],
  },
  {
    slug: 'consecrated-products',
    name: 'Consecrated Products',
    description: 'Lamps, incense and ritual essentials for a home altar or quiet corner.',
    subcategories: ['Lamps', 'Incense', 'Ritual Essentials', 'Frames'],
    products: [
      { title: 'Hand-Cast Brass Oil Lamp', sub: 'Lamps', tags: ['brass', 'lamp', 'diya', 'handmade', 'gifting'], price: 1850, compareAt: 2100, attrs: { material: 'Brass', height: '14 cm', weight: '420 g' }, blurb: 'A five-wick brass lamp cast in small batches; the weighted base keeps it steady.' },
      { title: 'Sandalwood Incense Sticks, Hand-Rolled', sub: 'Incense', tags: ['incense', 'sandalwood', 'hand-rolled'], price: 220, attrs: { count: '40 sticks', burnTime: '45 min each' }, blurb: 'Bamboo-core sticks rolled by hand with sandalwood powder and natural binders.' },
      { title: 'Pure Camphor Tablets', sub: 'Ritual Essentials', tags: ['camphor', 'ritual', 'aarti'], price: 160, attrs: { weight: '100 g' }, blurb: 'Clean-burning camphor tablets that leave little residue.' },
      { title: 'Kumkum in Brass Box', sub: 'Ritual Essentials', tags: ['kumkum', 'brass', 'ritual'], price: 340, attrs: { weight: '25 g', container: 'Brass, screw lid' }, blurb: 'Turmeric-based kumkum in a small screw-top brass container.' },
      { title: 'Clay Diya Set of Twelve', sub: 'Lamps', tags: ['diya', 'clay', 'festive', 'handmade'], price: 390, attrs: { material: 'Terracotta', count: '12' }, blurb: 'Wheel-thrown terracotta diyas, unglazed and fired at a local pottery.', newDaysAgo: 10 },
      { title: 'Cotton Wicks, Long Format', sub: 'Lamps', tags: ['wicks', 'cotton', 'lamp'], price: 120, attrs: { count: '200', length: '7 cm' }, blurb: 'Hand-twisted cotton wicks for brass and clay lamps.' },
      { title: 'Engraved Copper Altar Plate', sub: 'Frames', tags: ['copper', 'altar', 'plate', 'gifting'], price: 1490, attrs: { material: 'Copper', diameter: '20 cm' }, blurb: 'A shallow copper plate with a hand-engraved border for arranging flowers and lamps.' },
      { title: 'Guggul Dhoop Cones', sub: 'Incense', tags: ['incense', 'dhoop', 'resin'], price: 260, attrs: { count: '30 cones' }, blurb: 'Resin-rich cones with a warm, smoky fragrance. Use with a heat-safe holder.' },
    ],
  },
  {
    slug: 'yoga-store',
    name: 'Yoga Store',
    description: 'Mats, props and practice accessories in natural materials.',
    subcategories: ['Mats', 'Props', 'Meditation', 'Accessories'],
    products: [
      { title: 'Handwoven Cotton Yoga Mat', sub: 'Mats', tags: ['mat', 'cotton', 'handwoven', 'washable'], price: 1690, compareAt: 1990, attrs: { material: 'Cotton', size: '183 x 61 cm', weight: '1.6 kg' }, blurb: 'A dense, flat-woven cotton mat that can be machine washed on a gentle cycle.', variants: [{ name: 'Natural', price: 1690, compareAt: 1990 }, { name: 'Indigo', price: 1790, compareAt: 1990 }] },
      { title: 'Natural Rubber Grip Mat, 5 mm', sub: 'Mats', tags: ['mat', 'natural rubber', 'grip'], price: 3490, attrs: { material: 'Natural rubber, jute top', thickness: '5 mm' }, blurb: 'A jute surface bonded to natural rubber for traction in warm rooms.' },
      { title: 'Cork Yoga Block', sub: 'Props', tags: ['block', 'cork', 'props'], price: 790, attrs: { material: 'Cork', size: '23 x 15 x 7.5 cm' }, blurb: 'A firm cork block with rounded edges; heavier and steadier than foam.' },
      { title: 'Cotton Yoga Strap with Metal Buckle', sub: 'Props', tags: ['strap', 'cotton', 'props'], price: 390, attrs: { length: '2.4 m' }, blurb: 'A long cotton strap with a D-ring buckle that holds without slipping.' },
      { title: 'Buckwheat Meditation Cushion', sub: 'Meditation', tags: ['cushion', 'meditation', 'buckwheat', 'cotton'], price: 1890, attrs: { fill: 'Buckwheat hulls', cover: 'Removable cotton', diameter: '35 cm' }, blurb: 'A round zafu filled with buckwheat hulls that settle to your shape.', newDaysAgo: 4 },
      { title: 'Rectangular Yoga Bolster', sub: 'Props', tags: ['bolster', 'restorative', 'cotton'], price: 2190, attrs: { size: '60 x 30 x 15 cm', fill: 'Cotton batting' }, blurb: 'A firm rectangular bolster for supported and restorative postures.' },
      { title: 'Copper Water Bottle, 1 L', sub: 'Accessories', tags: ['copper', 'bottle', 'everyday'], price: 1290, compareAt: 1490, attrs: { material: 'Copper', capacity: '1 litre' }, blurb: 'A seamless copper bottle with a leak-resistant cap. Hand wash only.' },
      { title: 'Jute Mat Carry Bag', sub: 'Accessories', tags: ['bag', 'jute', 'mat'], price: 690, attrs: { material: 'Jute, cotton lining' }, blurb: 'A structured jute bag with a cotton lining and a wide shoulder strap.' },
      { title: 'Lavender Eye Pillow', sub: 'Meditation', tags: ['eye pillow', 'lavender', 'flax', 'restorative'], price: 490, attrs: { fill: 'Flax seed, dried lavender' }, blurb: 'A soft cotton eye pillow filled with flax seed and a little dried lavender.' },
    ],
  },
  {
    slug: 'natural-food',
    name: 'Natural Food',
    description: 'Millets, cold-pressed oils and pantry staples from small producers.',
    subcategories: ['Millets & Grains', 'Oils & Ghee', 'Sweeteners', 'Snacks', 'Spices'],
    products: [
      { title: 'Cold-Pressed Groundnut Oil', sub: 'Oils & Ghee', tags: ['oil', 'cold-pressed', 'groundnut', 'cooking'], price: 420, attrs: { process: 'Wood-pressed', origin: 'Tamil Nadu' }, blurb: 'Pressed slowly in a wooden ghani and filtered by settling, without heat or chemicals.', variants: [{ name: '1 L', price: 420 }, { name: '2 L', price: 799, compareAt: 840 }] },
      { title: 'Foxtail Millet, Unpolished', sub: 'Millets & Grains', tags: ['millet', 'unpolished', 'grain', 'cooking'], price: 180, attrs: { weight: '1 kg', origin: 'Karnataka' }, blurb: 'Whole foxtail millet with the bran intact; cooks like rice in about fifteen minutes.' },
      { title: 'Desi Cow Ghee, Bilona Method', sub: 'Oils & Ghee', tags: ['ghee', 'cooking', 'bilona'], price: 950, compareAt: 1100, attrs: { volume: '500 ml', process: 'Hand-churned from curd' }, blurb: 'Ghee made by churning curd into butter and simmering it slowly.' },
      { title: 'Organic Jaggery Powder', sub: 'Sweeteners', tags: ['jaggery', 'sweetener', 'organic'], price: 210, attrs: { weight: '500 g' }, blurb: 'Free-flowing jaggery powder that dissolves easily in tea and baking.' },
      { title: 'Raw Forest Honey', sub: 'Sweeteners', tags: ['honey', 'raw', 'sweetener'], price: 480, attrs: { weight: '500 g', process: 'Unheated, strained' }, blurb: 'Multi-floral honey collected by forest communities and strained, not heated.', newDaysAgo: 8 },
      { title: 'Roasted Makhana, Himalayan Salt', sub: 'Snacks', tags: ['snack', 'makhana', 'roasted'], price: 260, attrs: { weight: '100 g' }, blurb: 'Fox nuts roasted with a little ghee and rock salt.' },
      { title: 'Ragi Breakfast Flakes', sub: 'Millets & Grains', tags: ['millet', 'ragi', 'breakfast'], price: 240, attrs: { weight: '400 g' }, blurb: 'Lightly toasted finger millet flakes; add to warm milk or yogurt.' },
      { title: 'Stone-Ground Turmeric Powder', sub: 'Spices', tags: ['turmeric', 'spice', 'stone-ground', 'cooking'], price: 190, attrs: { weight: '200 g', origin: 'Erode' }, blurb: 'Sun-dried turmeric fingers ground on stone in small lots.' },
      { title: 'Little Millet Pongal Mix', sub: 'Millets & Grains', tags: ['millet', 'ready mix', 'cooking'], price: 220, attrs: { weight: '500 g', serves: '6' }, blurb: 'Little millet, split moong and spices measured out for a one-pot pongal.', newDaysAgo: 2 },
    ],
  },
  {
    slug: 'health-and-immunity',
    name: 'Health and Immunity',
    description:
      'Herbal teas, powders and botanicals. These are food and lifestyle products; they are not intended to diagnose, treat, cure or prevent any condition.',
    subcategories: ['Herbal Teas', 'Botanical Powders', 'Wellness Kits'],
    products: [
      { title: 'Tulsi Green Tea, Loose Leaf', sub: 'Herbal Teas', tags: ['tea', 'tulsi', 'loose leaf'], price: 320, attrs: { weight: '100 g', cups: 'About 50' }, blurb: 'Green tea blended with three varieties of dried tulsi leaf.' },
      { title: 'Moringa Leaf Powder', sub: 'Botanical Powders', tags: ['moringa', 'powder', 'smoothie'], price: 280, attrs: { weight: '150 g' }, blurb: 'Shade-dried moringa leaves milled fine; stir into soups, dals or smoothies.' },
      { title: 'Ashwagandha Root Powder', sub: 'Botanical Powders', tags: ['ashwagandha', 'powder', 'root'], price: 340, attrs: { weight: '100 g' }, blurb: 'Dried root powder with an earthy taste, often mixed with warm milk and honey.' },
      { title: 'Triphala Powder', sub: 'Botanical Powders', tags: ['triphala', 'powder', 'herbal'], price: 230, attrs: { weight: '100 g' }, blurb: 'A traditional blend of three dried fruits in equal parts.' },
      { title: 'Ginger Lemongrass Infusion', sub: 'Herbal Teas', tags: ['tea', 'ginger', 'lemongrass', 'caffeine-free'], price: 290, attrs: { count: '25 bags', caffeine: 'None' }, blurb: 'A bright, caffeine-free infusion in compostable bags.', newDaysAgo: 5 },
      { title: 'Turmeric Latte Blend', sub: 'Herbal Teas', tags: ['turmeric', 'latte', 'spice'], price: 360, attrs: { weight: '100 g' }, blurb: 'Turmeric, cinnamon, black pepper and dry ginger, ready to whisk into hot milk.' },
      { title: 'Kitchen Botanicals Starter Kit', sub: 'Wellness Kits', tags: ['kit', 'gifting', 'powder', 'tea'], price: 990, compareAt: 1170, attrs: { contains: 'Moringa, turmeric latte, tulsi tea' }, blurb: 'Three of our most-requested botanical staples in one box.' },
    ],
  },
  {
    slug: 'clothing',
    name: 'Clothing',
    description: 'Handloom and organic cotton garments, cut for ease of movement.',
    subcategories: ['Kurtas', 'Pants', 'Stoles', 'Tees'],
    products: [
      { title: 'Handloom Cotton Kurta, Unisex', sub: 'Kurtas', tags: ['kurta', 'handloom', 'cotton', 'unisex'], price: 1590, compareAt: 1890, attrs: { fabric: 'Handloom cotton', fit: 'Relaxed' }, blurb: 'A relaxed kurta in breathable handloom cotton with side pockets.', variants: sizes(1590, 1890) },
      { title: 'Organic Cotton Yoga Pants', sub: 'Pants', tags: ['pants', 'organic cotton', 'yoga'], price: 1390, attrs: { fabric: 'Organic cotton, 5% elastane', waist: 'Drawstring' }, blurb: 'Soft, tapered pants with a drawstring waist and enough stretch for practice.', variants: sizes(1390) },
      { title: 'Khadi Stole, Natural Dye', sub: 'Stoles', tags: ['stole', 'khadi', 'natural dye'], price: 990, attrs: { size: '200 x 70 cm', dye: 'Indigo and madder' }, blurb: 'Hand-spun, hand-woven khadi dyed with indigo and madder.' },
      { title: 'Organic Cotton Crew Tee', sub: 'Tees', tags: ['tee', 'organic cotton', 'everyday'], price: 690, attrs: { fabric: 'Organic cotton, 180 gsm' }, blurb: 'A mid-weight everyday tee with a clean crew neck.', variants: sizes(690) },
      { title: 'Linen Blend Mandarin Shirt', sub: 'Kurtas', tags: ['shirt', 'linen', 'summer'], price: 1890, attrs: { fabric: 'Linen-cotton' }, blurb: 'A mandarin-collar shirt in a cool linen-cotton blend.', variants: sizes(1890), newDaysAgo: 7 },
      { title: 'Wrap-Around Cotton Dhoti Pants', sub: 'Pants', tags: ['pants', 'dhoti', 'cotton'], price: 1190, attrs: { fabric: 'Cotton' }, blurb: 'Dhoti-style pants with an elastic back and a generous drape.', variants: sizes(1190) },
      { title: 'Block-Print Cotton Stole', sub: 'Stoles', tags: ['stole', 'block print', 'cotton', 'gifting'], price: 790, attrs: { size: '180 x 60 cm' }, blurb: 'Hand block-printed in Rajasthan with a small leaf motif.' },
    ],
  },
  {
    slug: 'body-care',
    name: 'Body Care',
    description: 'Soaps, oils and balms made with plant ingredients in small batches.',
    subcategories: ['Soaps', 'Hair Care', 'Skin Care', 'Bath'],
    products: [
      { title: 'Neem and Turmeric Cold-Process Soap', sub: 'Soaps', tags: ['soap', 'neem', 'turmeric', 'cold process'], price: 180, attrs: { weight: '100 g' }, blurb: 'A cold-process bar made with neem leaf and turmeric, cured for six weeks.' },
      { title: 'Sandalwood Glycerine Soap', sub: 'Soaps', tags: ['soap', 'sandalwood', 'glycerine'], price: 220, attrs: { weight: '100 g' }, blurb: 'A clear glycerine bar with a soft sandalwood fragrance.' },
      { title: 'Herbal Hair Oil, Coconut Base', sub: 'Hair Care', tags: ['hair oil', 'coconut', 'herbal'], price: 340, attrs: { volume: '200 ml' }, blurb: 'Coconut oil slow-infused with hibiscus, curry leaf and amla.' },
      { title: 'Reetha Shikakai Hair Wash Powder', sub: 'Hair Care', tags: ['hair wash', 'reetha', 'shikakai', 'powder'], price: 260, attrs: { weight: '200 g' }, blurb: 'A soap-free hair wash powder; mix with water into a paste.' },
      { title: 'Kokum Butter Lip Balm', sub: 'Skin Care', tags: ['lip balm', 'kokum', 'beeswax'], price: 150, attrs: { weight: '10 g' }, blurb: 'Kokum butter and beeswax in a small tin.' },
      { title: 'Multani Mitti Face Pack', sub: 'Skin Care', tags: ['face pack', 'clay', 'rose'], price: 240, attrs: { weight: '100 g' }, blurb: 'Fuller\'s earth with rose petal powder; mix with water or curd.', newDaysAgo: 9 },
      { title: 'Ubtan Bath Powder', sub: 'Bath', tags: ['bath', 'ubtan', 'gram flour'], price: 290, attrs: { weight: '150 g' }, blurb: 'Gram flour, turmeric and sandalwood for a gentle soap-free wash.' },
      { title: 'Kansa Foot Massage Bowl', sub: 'Bath', tags: ['kansa', 'massage', 'bronze', 'gifting'], price: 1290, attrs: { material: 'Kansa (bell metal), wood' }, blurb: 'A small kansa bowl on a wooden handle for an evening foot massage with oil.' },
    ],
  },
  {
    slug: 'home-decor',
    name: 'Home Decor',
    description: 'Brass, terracotta, jute and handloom pieces for calm, lived-in rooms.',
    subcategories: ['Brass & Copper', 'Textiles', 'Planters', 'Wall Decor'],
    products: [
      { title: 'Brass Urli Bowl, Medium', sub: 'Brass & Copper', tags: ['brass', 'urli', 'bowl', 'gifting'], price: 2890, compareAt: 3290, attrs: { material: 'Brass', diameter: '30 cm' }, blurb: 'A wide, shallow brass bowl for floating flowers and candles.' },
      { title: 'Terracotta Planter with Saucer', sub: 'Planters', tags: ['planter', 'terracotta', 'handmade'], price: 590, attrs: { material: 'Terracotta', height: '15 cm' }, blurb: 'A breathable terracotta pot with a matching saucer.' },
      { title: 'Handloom Cotton Cushion Cover', sub: 'Textiles', tags: ['cushion', 'handloom', 'cotton'], price: 690, attrs: { size: '45 x 45 cm', closure: 'Hidden zip' }, blurb: 'A textured handloom cover in undyed and indigo stripes.', variants: [{ name: 'Undyed', price: 690 }, { name: 'Indigo stripe', price: 740 }] },
      { title: 'Braided Jute Rug', sub: 'Textiles', tags: ['rug', 'jute', 'braided'], price: 2490, attrs: { size: '120 x 180 cm' }, blurb: 'A hand-braided jute rug with a flat, even weave.' },
      { title: 'Copper Jug and Tumbler Set', sub: 'Brass & Copper', tags: ['copper', 'jug', 'tumbler', 'gifting'], price: 2190, attrs: { contains: '1.5 L jug, 2 tumblers' }, blurb: 'A hammered copper jug with two matching tumblers.' },
      { title: 'Macramé Wall Hanging', sub: 'Wall Decor', tags: ['macrame', 'wall hanging', 'cotton'], price: 1190, attrs: { size: '60 x 90 cm' }, blurb: 'Knotted from undyed cotton cord on a driftwood rod.', newDaysAgo: 1 },
      { title: 'Block-Print Table Runner', sub: 'Textiles', tags: ['table runner', 'block print', 'cotton'], price: 890, attrs: { size: '180 x 35 cm' }, blurb: 'Hand block-printed in two earth tones on mid-weight cotton.' },
      { title: 'Carved Wooden Incense Holder', sub: 'Wall Decor', tags: ['incense holder', 'wood', 'carved'], price: 390, attrs: { material: 'Sheesham wood' }, blurb: 'A long sheesham tray that catches ash from incense sticks.' },
    ],
  },
  {
    slug: 'books',
    name: 'Books',
    description: 'Titles from Anvaya Press on cooking, practice and mindful living.',
    subcategories: ['Cooking', 'Practice', 'Living', 'Children'],
    products: [
      { title: 'The Millet Kitchen', sub: 'Cooking', tags: ['book', 'cooking', 'millet', 'recipes'], price: 599, attrs: { author: 'Anvaya Press', pages: '212', format: 'Paperback' }, blurb: 'Eighty everyday recipes built around millets, from breakfast to dessert.' },
      { title: 'Ten Minutes Each Morning', sub: 'Practice', tags: ['book', 'practice', 'routine'], price: 399, attrs: { author: 'Anvaya Press', pages: '148', format: 'Paperback' }, blurb: 'A short, practical guide to building a steady morning routine.' },
      { title: 'Quiet Rooms: Notes on Simple Living', sub: 'Living', tags: ['book', 'living', 'essays'], price: 449, attrs: { author: 'Anvaya Press', pages: '176', format: 'Paperback' }, blurb: 'Short essays on decluttering, slow mornings and making a home calm.' },
      { title: 'The Little Yoga Picture Book', sub: 'Children', tags: ['book', 'children', 'yoga', 'illustrated'], price: 349, attrs: { author: 'Anvaya Press', pages: '40', format: 'Hardcover' }, blurb: 'An illustrated book of animal-inspired postures for young children.' },
      { title: 'Grandmother\'s Pantry', sub: 'Cooking', tags: ['book', 'cooking', 'pantry', 'recipes'], price: 649, attrs: { author: 'Anvaya Press', pages: '240', format: 'Hardcover' }, blurb: 'Pickles, podis and preserves, with notes on storing them through the seasons.', newDaysAgo: 3 },
      { title: 'Breath and Stillness Journal', sub: 'Practice', tags: ['journal', 'practice', 'stationery', 'gifting'], price: 299, attrs: { pages: '160', paper: 'Recycled' }, blurb: 'A guided journal with prompts for a few quiet minutes a day.' },
    ],
  },
];
