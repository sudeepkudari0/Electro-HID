import sys
import json
import argparse
from jobspy import scrape_jobs
import pandas as pd

def main():
    parser = argparse.ArgumentParser(description="Scrape jobs and output JSON.")
    parser.add_argument("--query", required=True, help="Job title or keywords")
    parser.add_argument("--location", required=True, help="Location")
    parser.add_argument("--sites", help="Comma-separated list of sites (indeed,linkedin,glassdoor,zip_recruiter,naukri)", default="indeed,linkedin,zip_recruiter")
    parser.add_argument("--results", type=int, default=10, help="Results per site")
    parser.add_argument("--hours", type=int, default=72, help="Hours old")
    parser.add_argument("--remote", action="store_true", help="Remote only")
    parser.add_argument("--job-type", type=str, default=None, help="Job type: fulltime, parttime, internship, contract")
    parser.add_argument("--easy-apply", action="store_true", help="Filter for easy apply / direct apply jobs")
    parser.add_argument("--distance", type=int, default=50, help="Distance in miles from location")
    parser.add_argument("--country", type=str, default="usa", help="Country for Indeed/Glassdoor (e.g. usa, india, uk)")
    parser.add_argument("--linkedin-fetch-description", action="store_true", help="Fetch full description from LinkedIn (slower)")
    parser.add_argument("--exclude-urls", type=str, default="", help="Comma-separated list of job URLs to exclude")

    args = parser.parse_args()

    sites = [s.strip() for s in args.sites.split(",") if s.strip()]
    exclude_urls = set(u.strip() for u in args.exclude_urls.split(",") if u.strip())

    try:
        kwargs = {
            "site_name": sites,
            "search_term": args.query,
            "location": args.location,
            "hours_old": args.hours,
            "description_format": "markdown",
            "country_indeed": args.country,
            "distance": args.distance,
            "verbose": 0,
        }

        if args.remote:
            kwargs["is_remote"] = True
        if args.job_type:
            kwargs["job_type"] = args.job_type
        if args.easy_apply:
            kwargs["easy_apply"] = True
        if args.linkedin_fetch_description:
            kwargs["linkedin_fetch_description"] = True

        collected_jobs = []
        offset = 0
        max_attempts = 5 # Prevent infinite loops
        attempts = 0
        requested_results = args.results

        while len(collected_jobs) < requested_results and attempts < max_attempts:
            attempts += 1
            needed = requested_results - len(collected_jobs)
            kwargs["results_wanted"] = needed
            kwargs["offset"] = offset

            df = scrape_jobs(**kwargs)

            if len(df) == 0:
                break

            # Process batch
            batch_records = []
            df = df.where(pd.notnull(df), None)
            
            for _, row in df.iterrows():
                record = row.to_dict()
                # Clean up types and ensure JSON serialization works
                for k, v in record.items():
                    if pd.isna(v):
                        record[k] = None
                batch_records.append(record)

            new_jobs = []
            for job in batch_records:
                job_url = job.get("job_url")
                if job_url and job_url not in exclude_urls:
                    new_jobs.append(job)
                    exclude_urls.add(job_url) # Add to exclude set to avoid duplicates across loops

            collected_jobs.extend(new_jobs)
            
            # Update offset by the number of raw jobs fetched in this batch
            # Jobspy doesn't strictly adhere to offset across all sites equally, 
            # but we can try to increment it by the number of jobs we asked for or got
            offset += len(df)
            
            # If JobSpy returned fewer jobs than requested, we might have hit the end of the list
            if len(df) < needed:
                break

        # Slice to exactly requested results just in case
        collected_jobs = collected_jobs[:requested_results]

        if len(collected_jobs) == 0:
            print(json.dumps({"success": True, "data": []}))
            return

        print(json.dumps({"success": True, "data": collected_jobs}, default=str))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
