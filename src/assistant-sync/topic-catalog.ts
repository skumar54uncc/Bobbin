/**
 * Fixed topic list. The short label is what the sheet stores. The embed text is only for MiniLM.
 * Labels are specific on purpose ("export controls", not "technology"): a vague question such as
 * "that thing about chips being banned" can only be matched through a label that names the subject.
 * After any edit, run `node --import tsx eval/src/tune-topics.ts` to rebuild the vectors.
 */
export interface TopicLabel {
  label: string;
  embed: string;
}

export const TOPIC_CATALOG: readonly TopicLabel[] = [
  // AI and software
  { label: "AI security", embed: "AI security, securing language models, attacks on AI systems, and defenses that keep a model from being abused" },
  { label: "prompt injection", embed: "prompt injection, hidden instructions in a web page, and chatbots that obey untrusted text from strangers" },
  { label: "LLMs", embed: "large language models, tokens, chat models, and how a language model generates text" },
  { label: "RAG", embed: "retrieval augmented generation, fetching passages to answer a question with a language model" },
  { label: "vector databases", embed: "vector databases such as Pinecone or Weaviate, embedding indexes, and nearest neighbor search" },
  { label: "evals and benchmarking", embed: "evals and benchmarks that score model quality on a held out test set" },
  { label: "AI agents", embed: "AI agents that call tools, read the result, and choose the next step in a loop" },
  { label: "AI policy", embed: "AI policy and regulation, government rules for artificial intelligence, safety laws, and the EU AI Act" },
  { label: "machine learning", embed: "machine learning, training a model on features, and cross validation scores" },
  { label: "data science", embed: "data science, exploratory analysis, statistics, and notebooks that explain a dataset" },
  { label: "Python", embed: "the Python programming language, pip, and Python scripts" },
  { label: "TypeScript", embed: "the TypeScript programming language, types, and tsc" },
  { label: "JavaScript", embed: "the JavaScript programming language in the browser and in Node" },
  { label: "Chrome extensions", embed: "Chrome extensions, Manifest V3, service workers, and content scripts" },
  { label: "web development", embed: "web development, HTML, CSS, and building websites" },
  { label: "APIs", embed: "HTTP APIs, request and response schemas, and client libraries" },
  { label: "open source", embed: "open source software, licenses, maintainers, and public contributions" },
  { label: "GitHub", embed: "GitHub repositories, pull requests, issues, and cloning a project" },
  { label: "cloud infrastructure", embed: "cloud infrastructure, servers, Kubernetes, and deploying a service" },
  { label: "databases", embed: "relational databases, SQL tables, and query plans" },
  { label: "cybersecurity", embed: "cybersecurity, hackers, data breaches, ransomware, malware, and patching vulnerabilities" },
  { label: "privacy", embed: "online privacy, personal data collection, tracking, cookies, and data protection laws like GDPR" },
  { label: "product design", embed: "product design and user experience, UX research, wireframes, Figma, and usability" },
  { label: "product management", embed: "product management, roadmaps, prioritizing features, and writing product specs" },

  // Hardware, industry, and policy
  { label: "semiconductors", embed: "semiconductors and computer chips, chipmakers like TSMC, Nvidia, and Intel, foundries, and chip manufacturing" },
  { label: "export controls", embed: "export controls and trade restrictions, government licenses and bans on selling technology to other countries" },
  { label: "trade and tariffs", embed: "trade policy and tariffs, import taxes, trade wars, and supply chains between countries" },
  { label: "electric vehicles", embed: "electric vehicles, EV batteries, charging stations, and range" },
  { label: "Tesla", embed: "Tesla vehicles, factories, and the car company" },
  { label: "climate and energy", embed: "climate change, renewable energy, solar and wind power, emissions, and the power grid" },
  { label: "space", embed: "space exploration, rockets, satellites, NASA, SpaceX launches, and astronomy" },
  { label: "startups", embed: "startups, founders, fundraising, and early stage companies" },
  { label: "venture capital", embed: "venture capital, VC firms, seed rounds, valuations, and term sheets" },
  { label: "elections and politics", embed: "elections and politics, candidates, campaigns, polls, Congress, and voting" },

  // Work and career
  { label: "job search", embed: "job search, applications, recruiters, and open roles" },
  { label: "interviews", embed: "job interviews, interview questions, and a hiring loop" },
  { label: "resumes", embed: "resumes and cover letters, how to write and format a CV for a job application" },
  { label: "salary and compensation", embed: "salary negotiation, pay, equity, stock options, bonuses, and compensation offers" },
  { label: "layoffs", embed: "layoffs, job cuts, companies reducing headcount, and severance" },
  { label: "LinkedIn networking", embed: "LinkedIn networking, connection requests, and reaching out to people in a field" },
  { label: "immigration and visas", embed: "immigration and visas, H-1B, green cards, work permits, and citizenship applications" },
  { label: "productivity", embed: "productivity, focus, task lists, and getting work done" },
  { label: "note taking and PKM", embed: "note taking and personal knowledge management, linking notes, and a second brain" },

  // Money
  { label: "finance and investing", embed: "finance and investing, index funds, expense ratios, and a portfolio" },
  { label: "stock market", embed: "the stock market, share prices, earnings reports, and trading stocks" },
  { label: "crypto", embed: "cryptocurrency, Bitcoin, Ethereum, blockchain, and crypto exchanges" },
  { label: "economy and interest rates", embed: "the economy, inflation, interest rates, the Federal Reserve, and recessions" },
  { label: "personal taxes", embed: "personal income taxes, tax returns, deductions, and filing with the IRS" },
  { label: "mortgages and home buying", embed: "buying a house, mortgages, down payments, and mortgage rates" },

  // Home and life
  { label: "apartment hunting", embed: "apartment hunting, rent, leases, and touring a place to live" },
  { label: "San Francisco Bay Area", embed: "the San Francisco Bay Area, Oakland, San Jose, and neighborhoods around the bay" },
  { label: "flights and travel", embed: "flights, airports, layovers, and trip planning" },
  { label: "hotels and lodging", embed: "hotels, Airbnb rentals, booking a room, and places to stay on a trip" },
  { label: "cooking and recipes", embed: "cooking and recipes, ingredients, and how to prepare a meal" },
  { label: "restaurants", embed: "restaurants, places to eat, menus, reservations, and restaurant reviews" },
  { label: "fitness", embed: "fitness, workouts, running, and training" },
  { label: "nutrition and diet", embed: "nutrition and diet, calories, protein, vitamins, and healthy eating" },
  { label: "mental health", embed: "mental health, anxiety, depression, stress, therapy, and burnout" },
  { label: "medical care", embed: "medical care, doctors, clinics, symptoms, diagnoses, and treatments" },
  { label: "parenting", embed: "parenting, raising kids, babies, toddlers, and schools for children" },
  { label: "pets", embed: "pets, dogs and cats, adopting a pet, and taking care of an animal" },
  { label: "home improvement", embed: "home improvement, repairs, renovation, tools, and fixing things around the house" },
  { label: "gardening", embed: "gardening, plants, growing vegetables, soil, and watering a garden" },
  { label: "car buying", embed: "buying a car, car dealers, used cars, car reviews, and auto loans" },
  { label: "shopping", embed: "shopping, product pages, prices, and buying an item" },

  // Media and learning
  { label: "podcasts and video essays", embed: "podcasts and video essays, episodes, and long spoken explainers" },
  { label: "academic papers", embed: "academic papers, abstracts, citations, and a methods section" },
  { label: "documentation and manuals", embed: "documentation and manuals, command flags, and how to use a product" },
  { label: "books", embed: "books, novels, authors, book reviews, and reading lists" },
  { label: "movies and TV", embed: "movies and TV shows, streaming series, actors, and reviews of what to watch" },
  { label: "music", embed: "music, albums, songs, bands, concerts, and playlists" },
  { label: "video games", embed: "video games, consoles, game reviews, and playing games" },
  { label: "sports", embed: "sports, basketball and other games, a final score, and athletes" },
];

export const TOPIC_LABELS: readonly string[] = TOPIC_CATALOG.map((t) => t.label);
