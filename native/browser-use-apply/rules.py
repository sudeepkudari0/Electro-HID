from utils import match_dropdown_option, match_country_option, match_state_option

# Common EEO and deterministic synonyms
EEOC_SYNONYMS = {
    "gender": {
        "male": ["male", "man"],
        "female": ["female", "woman"],
        "decline": ["decline", "prefer not to", "identify", "not specified", "do not wish", "choose not"]
    },
    "race": {
        "white": ["white", "caucasian", "european"],
        "black": ["black", "african american", "african"],
        "asian": ["asian", "indian", "chinese", "japanese", "korean", "vietnamese", "filipino", "pacific islander"],
        "hispanic": ["hispanic", "latino", "latina", "chicano"],
        "decline": ["decline", "prefer not to", "identify", "not specified", "do not wish", "choose not"]
    },
    "veteran": {
        "yes": ["yes", "i am a protected veteran", "i identify as a veteran"],
        "no": ["no", "not a veteran", "not a protected veteran", "not protected"],
        "decline": ["decline", "prefer not to", "not specified", "do not wish", "choose not"]
    },
    "disability": {
        "yes": ["yes", "i have a disability", "disability", "individual with a disability"],
        "no": ["no", "do not have a disability", "no disability", "i do not"],
        "decline": ["decline", "prefer not to", "not specified", "do not wish", "choose not"]
    },
    "sponsorship": {
        "auth_yes": ["yes", "authorized to work", "legally authorized", "have legal authorization"],
        "auth_no": ["no", "not authorized"],
        "sponsor_yes": ["yes", "will require sponsorship", "require sponsorship", "will you now or in the future require"],
        "sponsor_no": ["no", "will not require", "do not require sponsorship", "do not require visa"]
    }
}

async def check_deterministic_eeo(label, options, candidate_summary):
    label_lower = label.lower()
    
    # 1. Gender
    if any(x in label_lower for x in ["gender", "sex"]) and not "spouse" in label_lower:
        val = (candidate_summary.get("gender") or "decline").lower()
        preferred = EEOC_SYNONYMS["gender"].get(val) or EEOC_SYNONYMS["gender"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 2. Race
    if any(x in label_lower for x in ["race", "ethnicity", "hispanic"]):
        val = (candidate_summary.get("race") or "decline").lower()
        preferred = EEOC_SYNONYMS["race"].get(val) or EEOC_SYNONYMS["race"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 3. Veteran
    if "veteran" in label_lower:
        val = (candidate_summary.get("veteranStatus") or "decline").lower()
        preferred = EEOC_SYNONYMS["veteran"].get(val) or EEOC_SYNONYMS["veteran"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 4. Disability
    if any(x in label_lower for x in ["disabilit", "handicap"]):
        val = (candidate_summary.get("disabilityStatus") or "decline").lower()
        preferred = EEOC_SYNONYMS["disability"].get(val) or EEOC_SYNONYMS["disability"]["decline"]
        return match_dropdown_option(options, preferred)
        
    # 5. Sponsorship / Work Authorization
    if any(x in label_lower for x in ["sponsor", "visa"]):
        val = (candidate_summary.get("sponsorshipRequired") or "no").lower()
        key = "sponsor_yes" if "yes" in val or val == "true" else "sponsor_no"
        preferred = EEOC_SYNONYMS["sponsorship"][key]
        return match_dropdown_option(options, preferred)
        
    if any(x in label_lower for x in ["authorized", "authorization", "legally", "work in"]):
        val = (candidate_summary.get("authorizedToWork") or "yes").lower()
        key = "auth_yes" if "yes" in val or val == "true" else "auth_no"
        preferred = EEOC_SYNONYMS["sponsorship"][key]
        return match_dropdown_option(options, preferred)
        
    return None

async def check_deterministic_location(label, options, candidate_summary):
    label_lower = label.lower()
    if any(x in label_lower for x in ["country", "nation", "citizenship"]) and not "sponsor" in label_lower:
        return match_country_option(options, candidate_summary.get("location"))
    if any(x in label_lower for x in ["state", "province", "region"]):
        return match_state_option(options, candidate_summary.get("location"))
    return None
