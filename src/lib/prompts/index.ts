import { PromptContext, PromptTemplate } from './types';
import { getBehavioralPrompt } from './templates/behavioral';
import { getTechnicalPrompt } from './templates/technical';
import { getSystemDesignPrompt } from './templates/system-design';
import { getCodingPrompt } from './templates/coding';
import { getHRScreeningPrompt } from './templates/hr-screening';
import { getGeneralPrompt } from './templates/general';

export * from './types';

export const getPromptTemplate = (context: PromptContext): PromptTemplate => {
    let template: PromptTemplate;
    
    switch (context.interviewType) {
        case 'behavioral':
            template = getBehavioralPrompt(context);
            break;
        case 'technical':
            template = getTechnicalPrompt(context);
            break;
        case 'system-design':
            template = getSystemDesignPrompt(context);
            break;
        case 'coding':
            template = getCodingPrompt(context);
            break;
        case 'hr-screening':
            template = getHRScreeningPrompt(context);
            break;
        case 'general':
        case 'case-study': // Fallback for case study until we implement a specific template
        default:
            template = getGeneralPrompt(context);
            break;
    }

    return template;
};
