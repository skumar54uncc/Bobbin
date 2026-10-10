/**
 * Pages used to tune the topic similarity threshold. `text` is what capture embeds: the title, then
 * the start of the page. `expected` are labels a reader would want; `accept` are also fine (not
 * required, not counted as wrong).
 */
export interface TopicFixture {
  id: string;
  title: string;
  text: string;
  expected: string[];
  accept?: string[];
}

export const TOPIC_FIXTURES: readonly TopicFixture[] = [
  {
    id: "injection",
    title: "Why chatbots obey strangers",
    text: "The article explains why chatbots obey strangers. A hidden instruction in a web page tells the model to ignore its rules and leak the system prompt. The author calls this prompt injection and shows a defense that strips untrusted text before the model sees it.",
    expected: ["prompt injection", "AI security"],
    accept: ["LLMs"],
  },
  {
    id: "vectors",
    title: "Comparing vector databases",
    text: "Pinecone and Weaviate store embeddings so a search can find a paragraph by meaning. The post compares index types and how to filter metadata on a vector database.",
    expected: ["vector databases"],
    accept: ["databases", "RAG"],
  },
  {
    id: "rag",
    title: "RAG over the company wiki",
    text: "Retrieval augmented generation fetches a few passages from the company wiki and puts them in the prompt before the model answers. The writeup is about RAG, not about training a new model.",
    expected: ["RAG"],
    accept: ["LLMs", "vector databases"],
  },
  {
    id: "tesla",
    title: "Tesla quarterly deliveries",
    text: "Tesla posted delivery numbers for the quarter and described the factory ramp in Fremont and Austin. The piece is about vehicle production at the car company.",
    expected: ["Tesla"],
    accept: ["electric vehicles", "stock market"],
  },
  {
    id: "apartment",
    title: "Touring a one bedroom in Oakland",
    text: "We toured a one bedroom in Oakland listed for rent. The notes cover the lease length, pet rules, and how far the apartment is from the station.",
    expected: ["apartment hunting", "San Francisco Bay Area"],
  },
  {
    id: "flights",
    title: "Nonstop flights to Boston",
    text: "The search compared nonstop flights from the airport to Boston in November, with prices and layover times. It is a trip planning page.",
    expected: ["flights and travel"],
  },
  {
    id: "recipe",
    title: "Butter roast chicken",
    text: "Roast the chicken and baste it with butter. The recipe serves four and lists the ingredients and the oven steps.",
    expected: ["cooking and recipes"],
  },
  {
    id: "interview",
    title: "My onsite loop",
    text: "The recruiter scheduled a loop of four interviews. I wrote down the questions they asked and how I answered the system design round.",
    expected: ["interviews"],
    accept: ["job search"],
  },
  {
    id: "extension",
    title: "Running a model in an offscreen document",
    text: "The Manifest V3 service worker cannot hold a long WebAssembly session, so the Chrome extension loads the model in an offscreen document. The content script only runs after the privacy checks.",
    expected: ["Chrome extensions"],
    accept: ["JavaScript", "web development"],
  },
  {
    id: "python",
    title: "Cross validation with scikit learn",
    text: "The notebook trains a model with scikit learn on tabular features and prints a cross validation score. The example is written in Python.",
    expected: ["machine learning"],
    accept: ["Python", "data science"],
  },
  {
    id: "investing",
    title: "Rebalancing a taxable account",
    text: "The portfolio note explains index funds, expense ratios, and how to rebalance a taxable account. It is about long term investing.",
    expected: ["finance and investing"],
    accept: ["stock market", "personal taxes"],
  },
  {
    id: "sports",
    title: "Fourth quarter comeback",
    text: "The game recap covers the fourth quarter, the final score, and the injured point guard. It is a basketball writeup.",
    expected: ["sports"],
  },
  {
    id: "show",
    title: "Season finale review",
    text: "The review discusses the season finale, the cast, and whether the show is worth watching this weekend.",
    expected: ["movies and TV"],
  },
  {
    id: "github",
    title: "Contributing guide",
    text: "The repository README explains how to clone the project, run the tests, and open a pull request on GitHub.",
    expected: ["GitHub"],
    accept: ["open source"],
  },
  {
    id: "paper",
    title: "A held out evaluation",
    text: "The abstract reports a result on a held out test set and cites the method section. The PDF is an academic paper.",
    expected: ["academic papers"],
    accept: ["evals and benchmarking"],
  },
  {
    id: "manual",
    title: "Install guide",
    text: "The manual lists each command, its flags, and an example. This is the product documentation for installing the tool.",
    expected: ["documentation and manuals"],
  },
  {
    id: "agents",
    title: "Agents that browse",
    text: "The agent loop lets the model call tools, read the result, and decide the next step. The post is about AI agents that browse and complete tasks.",
    expected: ["AI agents"],
    accept: ["LLMs"],
  },
  {
    id: "chrome-noise",
    title: "Loading",
    text: "Skip to content. Loading. Accept cookies. Subscribe to the newsletter. Share this page.",
    expected: [],
  },
  {
    id: "chips",
    title: "New rules limit sales of advanced chips to China",
    text: "New rules limit sales of advanced chips to China. The Commerce Department announced new export controls on advanced semiconductors and the equipment used to make them. Companies that sell high end graphics processors and chipmaking tools will need a license before shipping to buyers in China. Nvidia said the rules would cut into data center revenue, while ASML warned that lithography machines are now covered.",
    expected: ["export controls", "semiconductors"],
    accept: ["trade and tariffs"],
  },
  {
    id: "foundry",
    title: "Inside the race to 2 nanometers",
    text: "Inside the race to 2 nanometers. TSMC, Samsung, and Intel are spending billions on new fabs. Gate all around transistors and extreme ultraviolet lithography decide who can make the fastest processors.",
    expected: ["semiconductors"],
  },
  {
    id: "tariffs",
    title: "What the new tariffs mean for prices",
    text: "What the new tariffs mean for prices. Import duties on steel, furniture, and electronics rise next month. Retailers say shoppers will pay more as supply chains shift to other countries.",
    expected: ["trade and tariffs"],
    accept: ["economy and interest rates", "shopping"],
  },
  {
    id: "ai-act",
    title: "The EU AI Act, explained",
    text: "The EU AI Act, explained. Lawmakers approved rules that ban some uses of artificial intelligence and require risk assessments for high risk systems. Companies building general purpose models must publish summaries of training data.",
    expected: ["AI policy"],
    accept: ["LLMs", "privacy"],
  },
  {
    id: "breach",
    title: "Hospital network hit by ransomware",
    text: "Hospital network hit by ransomware. Attackers encrypted patient records and demanded payment in Bitcoin. Security researchers traced the intrusion to an unpatched VPN appliance.",
    expected: ["cybersecurity"],
    accept: ["medical care", "crypto"],
  },
  {
    id: "cookies",
    title: "How websites follow you around",
    text: "How websites follow you around. Third party cookies, fingerprinting, and data brokers build a profile of everything you do online. Here is how to opt out and what GDPR lets you request.",
    expected: ["privacy"],
    accept: ["cybersecurity"],
  },
  {
    id: "ux",
    title: "Usability testing on a budget",
    text: "Usability testing on a budget. Five users and a Figma prototype find most of the problems in a checkout flow. Watch where people hesitate and redesign the wireframes before writing code.",
    expected: ["product design"],
    accept: ["product management"],
  },
  {
    id: "roadmap",
    title: "Saying no to features",
    text: "Saying no to features. A product manager explains how she prioritizes the roadmap, writes one page specs, and keeps engineering focused on the few bets that matter this quarter.",
    expected: ["product management"],
    accept: ["productivity", "startups"],
  },
  {
    id: "ev-range",
    title: "Winter range test of five EVs",
    text: "Winter range test of five EVs. We drove each electric car until the battery died in freezing weather and timed how long fast charging took at highway stations.",
    expected: ["electric vehicles"],
    accept: ["Tesla", "car buying"],
  },
  {
    id: "solar",
    title: "Is rooftop solar worth it",
    text: "Is rooftop solar worth it. Panel prices fell again, and a home battery can cover evening demand. The grid operator says more renewable power is coming online than ever.",
    expected: ["climate and energy"],
    accept: ["home improvement"],
  },
  {
    id: "launch",
    title: "Starship reaches orbit",
    text: "Starship reaches orbit. SpaceX launched its largest rocket and caught the booster on the tower. NASA plans to use the vehicle to land astronauts on the Moon.",
    expected: ["space"],
  },
  {
    id: "seed-round",
    title: "How we raised our seed round",
    text: "How we raised our seed round. We pitched forty investors, signed a term sheet at a twelve million valuation, and learned what venture firms look for in a founding team.",
    expected: ["venture capital"],
    accept: ["startups"],
  },
  {
    id: "polls",
    title: "Senate race tightens in new poll",
    text: "Senate race tightens in new poll. The two candidates are within two points with three weeks until election day. Both campaigns are spending heavily on ads to turn out voters.",
    expected: ["elections and politics"],
  },
  {
    id: "resume",
    title: "One page or two",
    text: "One page or two. A recruiter reviews resumes and explains how to format your CV, what to cut, and how to write a cover letter that gets read.",
    expected: ["resumes"],
    accept: ["job search"],
  },
  {
    id: "negotiate",
    title: "Negotiating an offer",
    text: "Negotiating an offer. The hiring manager came back with base pay, a signing bonus, and stock options. Here is how I asked for more equity without losing the offer.",
    expected: ["salary and compensation"],
    accept: ["job search", "interviews"],
  },
  {
    id: "cuts",
    title: "Tech giant cuts 10,000 jobs",
    text: "Tech giant cuts 10,000 jobs. The company said it would reduce headcount in recruiting and devices, offering sixteen weeks of severance to affected employees.",
    expected: ["layoffs"],
    accept: ["job search"],
  },
  {
    id: "h1b",
    title: "H-1B lottery results",
    text: "H-1B lottery results. Employers learned which petitions were selected. Applicants who were not picked are weighing other work permits and green card options.",
    expected: ["immigration and visas"],
  },
  {
    id: "earnings",
    title: "Shares jump after earnings beat",
    text: "Shares jump after earnings beat. The company reported quarterly revenue above estimates and raised guidance, sending the stock up eight percent in after hours trading.",
    expected: ["stock market"],
    accept: ["finance and investing"],
  },
  {
    id: "bitcoin",
    title: "Bitcoin passes a new high",
    text: "Bitcoin passes a new high. Crypto exchanges saw record volume as ether and other tokens rallied. Analysts point to inflows into spot bitcoin funds.",
    expected: ["crypto"],
    accept: ["finance and investing", "stock market"],
  },
  {
    id: "fed",
    title: "The Fed holds rates steady",
    text: "The Fed holds rates steady. Federal Reserve officials kept interest rates unchanged and said inflation is cooling but the labor market remains strong.",
    expected: ["economy and interest rates"],
    accept: ["finance and investing", "stock market", "mortgages and home buying"],
  },
  {
    id: "taxes",
    title: "Deductions people forget",
    text: "Deductions people forget. Before you file your tax return, check the home office deduction, student loan interest, and charitable gifts. The IRS deadline is April 15.",
    expected: ["personal taxes"],
  },
  {
    id: "mortgage",
    title: "First time buyer checklist",
    text: "First time buyer checklist. Get preapproved for a mortgage, save for a down payment and closing costs, and compare rates from three lenders before you make an offer on a house.",
    expected: ["mortgages and home buying"],
  },
  {
    id: "hotel",
    title: "Where to stay in Lisbon",
    text: "Where to stay in Lisbon. We compare hotels and Airbnb apartments in Alfama and Baixa, with prices per night and how far each place is from the tram.",
    expected: ["hotels and lodging"],
    accept: ["flights and travel"],
  },
  {
    id: "restaurant",
    title: "Best new restaurants this fall",
    text: "Best new restaurants this fall. A critic picks the spots worth a reservation, from a tasting menu counter to a neighborhood taqueria, with what to order at each.",
    expected: ["restaurants"],
  },
  {
    id: "protein",
    title: "How much protein do you need",
    text: "How much protein do you need. A dietitian explains daily protein targets, which foods are high in protein, and how to plan healthy meals without counting every calorie.",
    expected: ["nutrition and diet"],
    accept: ["fitness"],
  },
  {
    id: "burnout",
    title: "Recognizing burnout",
    text: "Recognizing burnout. Chronic stress, trouble sleeping, and feeling detached from work are common signs. A therapist describes when to take time off and how to ask for help with anxiety.",
    expected: ["mental health"],
  },
  {
    id: "clinic",
    title: "Booking a dermatologist",
    text: "Booking a dermatologist. The clinic page lists appointment times, which insurance plans the doctors accept, and what to expect at a skin exam.",
    expected: ["medical care"],
  },
  {
    id: "toddler",
    title: "Toddler sleep regression",
    text: "Toddler sleep regression. Parents share how they handled two year olds who suddenly stopped napping, and what the pediatrician suggested for bedtime routines.",
    expected: ["parenting"],
  },
  {
    id: "puppy",
    title: "First week with a rescue dog",
    text: "First week with a rescue dog. Crate training, feeding schedules, and the vet visit after we adopted our puppy from the shelter.",
    expected: ["pets"],
  },
  {
    id: "drywall",
    title: "Patching drywall",
    text: "Patching drywall. Cut out the damaged section, screw in a new piece, tape the seams, and sand before painting. You need a utility knife, joint compound, and a putty knife.",
    expected: ["home improvement"],
  },
  {
    id: "tomatoes",
    title: "Growing tomatoes in containers",
    text: "Growing tomatoes in containers. Pick a large pot, use good soil, water every morning, and stake the plants once they start to fruit.",
    expected: ["gardening"],
  },
  {
    id: "used-car",
    title: "Buying a used car",
    text: "Buying a used car. Check the vehicle history report, take it to a mechanic, and compare the dealer price with what private sellers ask. Get an auto loan preapproval first.",
    expected: ["car buying"],
  },
  {
    id: "novel",
    title: "The best novels of the year",
    text: "The best novels of the year. Our critics picked ten books, from a debut author to a long awaited sequel, with a short review of each for your reading list.",
    expected: ["books"],
  },
  {
    id: "album",
    title: "Album review",
    text: "Album review. The band's new record trades guitars for synths. The best songs are near the end, and the tour starts next month with concerts in twelve cities.",
    expected: ["music"],
  },
  {
    id: "game",
    title: "Game of the year contenders",
    text: "Game of the year contenders. We played every major release on console and PC. These are the video games with the best stories, combat, and open worlds.",
    expected: ["video games"],
  },
  {
    id: "vector-index",
    title: "Choosing an index for 50 million embeddings",
    text: "Choosing an index for 50 million embeddings. We moved our semantic search from a brute force scan to an approximate nearest neighbor index. The candidates were HNSW in pgvector, Pinecone, and a self hosted Weaviate cluster.",
    expected: ["vector databases"],
    accept: ["databases"],
  },
  {
    id: "cookie-noise",
    title: "Sign in",
    text: "Sign in. Email or phone. Forgot password. Create account. Terms of service. Privacy. Help.",
    expected: [],
    accept: ["privacy"],
  },
];

/**
 * Vague recall: a question that shares no word with the page title. The assistant reading the sheet
 * can only find the page through its topics. A case passes when one of the question's top 3 labels
 * is on the page.
 */
export interface VagueRecallCase {
  id: string;
  question: string;
  page: string;
}

export const VAGUE_RECALL: readonly VagueRecallCase[] = [
  { id: "chips-ban", question: "what was that thing about the government stopping processor shipments overseas?", page: "chips" },
  { id: "fabs", question: "the piece on who builds the smallest transistors", page: "foundry" },
  { id: "import-duties", question: "something about import taxes making stuff costlier", page: "tariffs" },
  { id: "eu-law", question: "that European law about artificial intelligence", page: "ai-act" },
  { id: "hacked", question: "the story where hackers locked a medical system", page: "breach" },
  { id: "rocket", question: "that rocket launch I read about", page: "launch" },
  { id: "rental", question: "where did I read notes about renting a flat near BART?", page: "apartment" },
  { id: "embeddings", question: "the post about nearest neighbor search for semantic search", page: "vector-index" },
  { id: "pay", question: "what did I read about asking for more equity?", page: "negotiate" },
  { id: "visa", question: "something about work permits for foreign employees", page: "h1b" },
  { id: "rates", question: "did I read anything about the central bank and inflation?", page: "fed" },
  { id: "house", question: "that guide about down payments and lenders", page: "mortgage" },
  { id: "stay", question: "where to sleep on my Portugal trip", page: "hotel" },
  { id: "stress", question: "the article about feeling exhausted at work", page: "burnout" },
  { id: "dog", question: "tips I read for a newly adopted animal", page: "puppy" },
  { id: "electric", question: "how far battery cars go in the cold", page: "ev-range" },
];
