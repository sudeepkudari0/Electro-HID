// Shared robust progressive JSON parser supporting live streaming chunks, smart quotes, key synonyms, and multiline strings
export interface StructuredTeleprompterAnswer {
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
        if (!text.includes('"hook"') && !text.includes('"points"') && !text.includes('"Direct Hook"') && !text.includes('"Key Points"')) {
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

            if (hook || (Array.isArray(points) && points.length > 0) || edgeCase) {
                return {
                    hook: typeof hook === 'string' ? hook : undefined,
                    points: Array.isArray(points) ? points.map(String) : typeof points === 'string' ? [points] : undefined,
                    edgeCase: typeof edgeCase === 'string' ? edgeCase : undefined,
                };
            }
        }
    } catch {
        // Progressive fallback when streaming OR when string has unescaped multiline characters
    }

    // 5. Bulletproof multiline regex extraction supporting all key synonyms & unescaped quotes/newlines
    const hookMatch = /"(?:hook|Direct Hook|bottomLine|bottom_line|summary)"\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*"(?:points|Key Points|edgeCase|Edge Case|Trade-off)"|,\s*\}$|^\s*\}$|$))/i.exec(text);
    const edgeCaseMatch = /"(?:edgeCase|Edge Case|Trade-off|trade_off|nuance|risk)"\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*"(?:hook|points)"|,\s*\}$|^\s*\}$|$))/i.exec(text);

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

    if (!hookMatch && points.length === 0 && !edgeCaseMatch) {
        return null;
    }

    return {
        hook: hookMatch ? hookMatch[1].replace(/\\"/g, '"').replace(/\n+/g, ' ').trim() : undefined,
        points: points.length > 0 ? points : undefined,
        edgeCase: edgeCaseMatch ? edgeCaseMatch[1].replace(/\\"/g, '"').replace(/\n+/g, ' ').trim() : undefined,
    };
}
