import asyncio
import sys
import argparse
import json
from playwright.async_api import async_playwright

async def wait_for_linkedin_auth(context, page, timeout=900):
    """
    Periodically checks if the user has authenticated on LinkedIn.
    Checks cookies for 'li_at' and URL patterns.
    """
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        try:
            # Check if page is closed
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
                return {
                    "success": True,
                    "reason": "li_at_cookie_present",
                    "url": current_url
                }

        except Exception as e:
            # Context or page might be closed
            break
        await asyncio.sleep(1)

    # Final check on cookies after loop exit (e.g., if user closed browser)
    try:
        cookies = await context.cookies()
        li_at_cookie = [c for c in cookies if c.get("name") == "li_at" and "linkedin.com" in c.get("domain", "")]
        if li_at_cookie:
            return {
                "success": True,
                "reason": "li_at_cookie_present",
                "url": page.url if not page.is_closed() else ""
            }
    except Exception:
        pass

    return {
        "success": False,
        "reason": "closed_or_timeout",
        "url": ""
    }

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", choices=["linkedin", "default"], required=True)
    parser.add_argument("--user-data-dir", required=True)
    args = parser.parse_args()

    async with async_playwright() as p:
        print(json.dumps({"type": "status", "message": f"Launching browser for manual {args.site} login..."}))
        sys.stdout.flush()

        chrome_args = [
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--disable-features=InfiniteSessionRestore,PasswordManagerOnboarding",
            "--hide-crash-restore-bubble",
            "--noerrdialogs",
            "--password-store=basic",
            "--disable-save-password-bubble",
            "--disable-popup-blocking",
        ]

        # Launch persistent context
        context = await p.chromium.launch_persistent_context(
            user_data_dir=args.user_data_dir,
            headless=False,
            args=chrome_args,
            viewport={"width": 1280, "height": 800}
        )

        page = context.pages[0] if context.pages else await context.new_page()

        if args.site == "linkedin":
            await page.goto("https://www.linkedin.com/login")
            print(json.dumps({"type": "status", "message": "Please log in to LinkedIn in the browser window..."}))
            sys.stdout.flush()
            
            result = await wait_for_linkedin_auth(context, page)
            if result["success"]:
                print(json.dumps({
                    "type": "login_status",
                    "success": True,
                    "message": "LinkedIn authentication detected!",
                    "details": result
                }))
            else:
                print(json.dumps({
                    "type": "login_status",
                    "success": False,
                    "message": "LinkedIn login not completed or browser closed.",
                    "details": result
                }))
            sys.stdout.flush()
        else:
            # Default browser
            await page.goto("https://www.google.com")
            print(json.dumps({"type": "status", "message": "Default browser session opened. Navigate to any site and log in. Close browser when done."}))
            sys.stdout.flush()

            # Just wait for browser context to close (e.g. user closes the window)
            while len(context.pages) > 0:
                try:
                    await asyncio.sleep(1)
                except Exception:
                    break

            print(json.dumps({
                "type": "login_status",
                "success": True,
                "message": "Default browser session closed and saved."
            }))
            sys.stdout.flush()

        await context.close()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print(json.dumps({"type": "login_status", "success": False, "message": "Interrupted by user"}))
        sys.stdout.flush()
