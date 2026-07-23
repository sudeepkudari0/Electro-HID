// Shared robust progressive JSON parser supporting live streaming chunks, smart quotes, key synonyms, and multiline strings
export interface StructuredTeleprompterAnswer {
    answer?: string;
    reflection?: string;
    hook?: string;
    points?: string[];
    edgeCase?: string;
}

export function parseProgressiveJson(rawText?: string): StructuredTeleprompterAnswer | null {
    if (!rawText) return null;
    let text = rawText.trim();

    // 1. Strip markdown code fences if present (e.g. ```json ... ```)
    text = text.replace(/```(?:json)?\s*([\s\S]*?)\s*(?:```|$)/gi, '$1').trim();

    // 2. Normalize smart/curly double quotes to straight quotes
    text = text.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');

    // 3. Find the opening { and optional closing }
    const firstBrace = text.indexOf('{');
    if (firstBrace !== -1) {
        const lastBrace = text.lastIndexOf('}');
        if (lastBrace !== -1 && lastBrace > firstBrace) {
            text = text.substring(firstBrace, lastBrace + 1);
        } else {
            text = text.substring(firstBrace);
        }
    } else {
        if (!text.includes('"hook"') && !text.includes('"points"') && !text.includes('"answer"') && !text.includes('"narrative"')) {
            return null;
        }
    }

    // 4. Clean control characters & literal newlines inside strings so JSON.parse can succeed
    const cleanForParse = text.replace(/,\s*([\]}])/g, '$1');
    try {
        const parsed = JSON.parse(cleanForParse);
        if (parsed && typeof parsed === 'object') {
            const hook = parsed.hook || parsed['Direct Hook'] || parsed.bottomLine || parsed.bottom_line || parsed.summary;
            const points = parsed.points || parsed['Key Points'] || parsed['Key Talking Points'] || parsed.key_points || parsed.bullets || parsed.items;
            const edgeCase = parsed.edgeCase || parsed['Edge Case'] || parsed['Trade-off'] || parsed.trade_off || parsed.nuance || parsed.risk;
            const answer = parsed.answer || parsed.response || parsed.narrative;
            const reflection = parsed.reflection || parsed.lesson;

            let finalAnswer = typeof answer === 'string' ? answer : '';
            if (!finalAnswer) {
                const hookText = typeof hook === 'string' ? hook : '';
                const pointsText = Array.isArray(points) ? points.join(' ') : typeof points === 'string' ? points : '';
                finalAnswer = [hookText, pointsText].filter(Boolean).join('\n\n');
            }

            const finalReflection = typeof reflection === 'string' ? reflection : typeof edgeCase === 'string' ? edgeCase : undefined;

            return {
                answer: finalAnswer || undefined,
                reflection: finalReflection || undefined,
            };
        }
    } catch {
        // Progressive fallback when streaming OR when string has unescaped multiline characters
    }

    // 5. Bulletproof multiline regex extraction supporting all key synonyms & unescaped quotes/newlines
    const answerMatch = /"(?:answer|response|narrative)"\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*"(?:reflection|lesson|edgeCase|Edge Case)"|,\s*\}$|^\s*\}$|$))/i.exec(text);
    const reflectionMatch = /"(?:reflection|lesson|edgeCase|Edge Case|Trade-off|trade_off|nuance|risk)"\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*"(?:answer|response)"|,\s*\}$|^\s*\}$|$))/i.exec(text);

    let answerVal = answerMatch ? answerMatch[1].replace(/\\"/g, '"').replace(/\n+/g, ' ').trim() : undefined;
    const reflectionVal = reflectionMatch ? reflectionMatch[1].replace(/\\"/g, '"').replace(/\n+/g, ' ').trim() : undefined;

    if (!answerVal) {
        // Fallback to legacy hook / points
        const hookMatch = /"(?:hook|Direct Hook|bottomLine|bottom_line|summary)"\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*"(?:points|Key Points|edgeCase|Edge Case)"|,\s*\}$|^\s*\}$|$))/i.exec(text);

        let points: string[] = [];
        const pointsBlockMatch = /"(?:points|Key Points|Key Talking Points|key_points|bullets|items)"\s*:\s*\[([\s\S]*?)(?:\]|$)/i.exec(text);
        if (pointsBlockMatch) {
            const blockContent = pointsBlockMatch[1];
            const itemRegex = /"([\s\S]*?)"(?=\s*(?:,|$))/g;
            let m;
            while ((m = itemRegex.exec(blockContent)) !== null) {
                const pt = m[1].replace(/\\"/g, '"').replace(/\n+/g, ' ').trim();
                if (pt) points.push(pt);
            }
            const unclosedMatch = /(?:^|,)\s*"([^"]*)$/.exec(blockContent);
            if (unclosedMatch) {
                const pt = unclosedMatch[1].replace(/\\"/g, '"').replace(/\n+/g, ' ').trim();
                if (pt && !points.includes(pt)) points.push(pt);
            }
        }

        const hookVal = hookMatch ? hookMatch[1].replace(/\\"/g, '"').replace(/\n+/g, ' ').trim() : '';
        const pointsVal = points.join(' ');
        answerVal = [hookVal, pointsVal].filter(Boolean).join('\n\n');
    }

    if (!answerVal && !reflectionVal) {
        return null;
    }

    return {
        answer: answerVal || undefined,
        reflection: reflectionVal || undefined,
    };
}