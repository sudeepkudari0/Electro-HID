import asyncio

async def wait_for_wellfound_auth(context, page, timeout=900):
    """
    Polls until the user is authenticated on Wellfound.
    Detection strategy: URL-based — logged in means we're on wellfound.com
    and NOT being redirected to /users/sign_in or /login.
    """
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        try:
            if page.is_closed():
                break

            current_url = page.url
            # Must be on wellfound.com
            if "wellfound.com" in current_url:
                # If NOT on a login/signup page, we're in
                login_pages = ("/users/sign_in", "/login", "/sign_in", "/signup")
                if not any(lp in current_url for lp in login_pages):
                    # Extra confirmation: at least some wellfound cookies exist
                    cookies = await context.cookies()
                    wf_cookies = [c for c in cookies if "wellfound.com" in c.get("domain", "")]
                    if wf_cookies:
                        return {"success": True, "reason": "url_and_cookie", "url": current_url}

        except Exception:
            break
        await asyncio.sleep(1)

    return {"success": False, "reason": "closed_or_timeout", "url": ""}

async def wait_for_linkedin_auth(context, page, timeout=900):
    """
    Periodically checks if the user has authenticated on LinkedIn.
    Checks cookies for 'li_at' and URL patterns.
    """
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        try:
            if page.is_closed():
                break

            current_url = page.url
            if "linkedin.com/feed" in current_url or "linkedin.com/mynetwork" in current_url or "linkedin.com/jobs" in current_url:
                return {
                    "success": True,
                    "reason": "url_pattern",
                    "url": current_url
                }

            cookies = await context.cookies()
            li_at_cookie = [c for c in cookies if c.get("name") == "li_at" and "linkedin.com" in c.get("domain", "")]
            if li_at_cookie:
                if not ("login" in current_url or "signup" in current_url or "checkpoint" in current_url or "challengeId" in current_url):
                    return {
                        "success": True,
                        "reason": "li_at_cookie_present",
                        "url": current_url
                    }

        except Exception:
            break
        await asyncio.sleep(1)

    try:
        cookies = await context.cookies()
        li_at_cookie = [c for c in cookies if c.get("name") == "li_at" and "linkedin.com" in c.get("domain", "")]
        if li_at_cookie:
            current_url = page.url if not page.is_closed() else ""
            if current_url and not ("login" in current_url or "signup" in current_url or "checkpoint" in current_url or "challengeId" in current_url):
                return {
                    "success": True,
                    "reason": "li_at_cookie_present",
                    "url": current_url
                }
    except Exception:
        pass

    return {
        "success": False,
        "reason": "closed_or_timeout",
        "url": ""
    }
