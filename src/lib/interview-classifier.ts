import { InterviewType } from './prompts/types';

export const DETAILED_CATEGORIES = [
    'Resume',
    'Behavioral',
    'Project Deep Dive',
    'Java',
    'Spring Boot',
    'REST APIs',
    'SQL',
    'Hibernate',
    'Concurrency',
    'Collections',
    'Exception Handling',
    'Security',
    'Kafka',
    'Redis',
    'Docker',
    'AWS',
    'System Design',
    'Testing',
    'Debugging',
    'Leadership',
    'Conflict',
    'Failure',
    'Ownership',
    'Decision Making',
    'Architecture'
] as const;

export type DetailedCategory = typeof DETAILED_CATEGORIES[number];

// Core patterns for detailed categories
const CATEGORY_PATTERNS: Record<DetailedCategory, string[]> = {
    'Project Deep Dive': [
        'feature you built', 'walk me through', 'personally owned', 'production feature', 
        'project you owned', 'owned end-to-end', 'describe a project', 'feature you personally',
        'own end-to-end', 'walk me through a time', 'tell me about a project'
    ],
    'Resume': [
        'tell me about yourself', 'your background', 'experience', 'walk me through your resume', 
        'work history', 'resume', 'current role', 'previous role'
    ],
    'Ownership': [
        'ownership', 'personally owned', 'owned end-to-end', 'take ownership', 'initiative', 
        'drove', 'lead from the front', 'individual contributor'
    ],
    'Leadership': [
        'leadership', 'led a team', 'mentor', 'influence', 'direction', 'coached', 
        'guiding', 'lead', 'managed a team', 'managing engineers'
    ],
    'Conflict': [
        'conflict', 'disagreement', 'disagreed', 'clash', 'difficult coworker', 
        'argument', 'different opinion', 'resolution', 'disagree and commit'
    ],
    'Failure': [
        'failure', 'mistake', 'regret', 'wrong', 'screwed up', 'failed', 'error of judgment',
        'dropped the ball', 'bug in production'
    ],
    'Behavioral': [
        'tell me about a time', 'give me an example', 'describe a situation', 'proudest', 
        'challenge', 'difficult customer', 'tight deadline', 'under pressure', 'handling stress'
    ],
    'Java': [
        'java', 'jvm', 'garbage collection', 'jdk', 'multithreading java', 'concurrency utilities',
        'java memory model', 'heap space', 'garbage collector'
    ],
    'Spring Boot': [
        'spring', 'spring boot', 'dependency injection', 'autowired', 'spring mvc', 
        'spring security', 'ioc container', 'spring bean'
    ],
    'REST APIs': [
        'rest', 'api', 'endpoint', 'http status', 'post', 'get', 'put', 'delete', 
        'graphql', 'http method', 'restful', 'payload'
    ],
    'SQL': [
        'sql', 'database', 'query', 'postgres', 'mysql', 'join', 'index', 'transaction', 
        'acid', 'relational', 'indexing', 'explain plan', 'foreign key'
    ],
    'Hibernate': [
        'hibernate', 'jpa', 'orm', 'n+1 query', 'lazy load', 'entity mapping',
        'first level cache', 'second level cache', 'criteria api'
    ],
    'Concurrency': [
        'thread', 'concurrency', 'mutex', 'synchronized', 'lock', 'deadlock', 
        'race condition', 'semaphore', 'volatile', 'asynchronous', 'async/await',
        'thread pool', 'executor service'
    ],
    'Collections': [
        'collection', 'hashmap', 'arraylist', 'list', 'map', 'set', 'queue', 
        'treemap', 'linkedlist', 'concurrenthashmap'
    ],
    'Exception Handling': [
        'exception', 'try-catch', 'throwable', 'runtimeexception', 'nullpointer',
        'checked exception', 'unchecked exception', 'custom exception'
    ],
    'Security': [
        'security', 'oauth', 'jwt', 'auth', 'encryption', 'cross-site', 'csrf', 
        'xss', 'cors', 'https', 'ssl', 'authorization', 'authentication'
    ],
    'Kafka': [
        'kafka', 'message queue', 'producer', 'consumer', 'pub-sub', 'broker', 
        'zookeeper', 'partition', 'offset', 'consumer group'
    ],
    'Redis': [
        'redis', 'cache', 'in-memory', 'eviction', 'pubsub', 'distributed cache',
        'redis cluster'
    ],
    'Docker': [
        'docker', 'container', 'dockerfile', 'docker-compose', 'kubernetes', 'k8s'
    ],
    'AWS': [
        'aws', 's3', 'ec2', 'rds', 'lambda', 'cloud', 'dynamodb', 'sqs', 'sns', 'iam'
    ],
    'System Design': [
        'system design', 'design a', 'scalability', 'load balance', 'rate limit', 
        'sharding', 'replica', 'consistent hashing', 'high availability', 'microservices'
    ],
    'Testing': [
        'test', 'junit', 'unit test', 'mock', 'integration test', 'tdd', 'mockito', 'assertion'
    ],
    'Debugging': [
        'debug', 'troubleshoot', 'production incident', 'profiling', 'log', 
        'heap dump', 'thread dump', 'stack trace', 'debugger'
    ],
    'Decision Making': [
        'decision', 'trade-off', 'choose', 'why did you choose', 'how did you select', 
        'alternative', 'evaluation'
    ],
    'Architecture': [
        'architecture', 'design pattern', 'structure', 'clean code', 'monolith', 
        'microservice', 'solid principles', 'uml'
    ]
};

export function classifyDetailedQuestion(text: string): DetailedCategory {
    const lowerText = text.toLowerCase();
    
    let bestCategory: DetailedCategory = 'Behavioral';
    let maxScore = 0;

    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
        let score = 0;
        patterns.forEach(pattern => {
            if (lowerText.includes(pattern)) {
                // Exact phrases or longer patterns get higher weights
                const weight = pattern.split(' ').length;
                score += weight;
            }
        });

        if (score > maxScore) {
            maxScore = score;
            bestCategory = category as DetailedCategory;
        }
    }

    // Default to Resume if text references personal intro, default to Behavioral if low score
    if (maxScore === 0) {
        if (lowerText.includes('tell me about yourself') || lowerText.includes('background')) {
            return 'Resume';
        }
        return 'Behavioral';
    }

    // Rule-based Overrides (Change 8)
    // System Design / Architecture Questions ONLY when explicitly asking to design/scale/whiteboard,
    // NOT when asking "Tell me about..." or "Walk me through..." a feature/project they built.
    const isSystemDesignOrArch = (bestCategory === 'System Design' || bestCategory === 'Architecture');
    const isTellOrWalkThrough = lowerText.includes('tell me about') || 
                                lowerText.includes('walk me through') || 
                                lowerText.includes('describe') || 
                                lowerText.includes('feature you built') || 
                                lowerText.includes('project you built') ||
                                lowerText.includes('feature you owned') ||
                                lowerText.includes('project you owned');

    if (isSystemDesignOrArch && isTellOrWalkThrough) {
        return 'Project Deep Dive';
    }

    return bestCategory;
}

export function classifyQuestion(text: string): InterviewType {
    const category = classifyDetailedQuestion(text);
    
    // Map DetailedCategory back to InterviewType
    switch (category) {
        case 'Resume':
            return 'general';
        case 'Behavioral':
        case 'Project Deep Dive':
        case 'Leadership':
        case 'Conflict':
        case 'Failure':
        case 'Ownership':
        case 'Decision Making':
            return 'behavioral';
        case 'System Design':
        case 'Architecture':
            // Double check if it's really system design
            const lower = text.toLowerCase();
            const hasDesignKeywords = lower.includes('design') || lower.includes('scale') || 
                                      lower.includes('architecture') || lower.includes('build a system') || 
                                      lower.includes('whiteboard') || lower.includes('how would you design');
            return hasDesignKeywords ? 'system-design' : 'behavioral';
        case 'Java':
        case 'Spring Boot':
        case 'REST APIs':
        case 'SQL':
        case 'Hibernate':
        case 'Concurrency':
        case 'Collections':
        case 'Exception Handling':
        case 'Security':
        case 'Kafka':
        case 'Redis':
        case 'Docker':
        case 'AWS':
        case 'Testing':
        case 'Debugging':
            return 'technical';
        default:
            return 'general';
    }
}
