<!--
platform: hackerone
variant: generic
version: 1.0.0
required-fields: title,severity,target,vulnerability_class,summary,steps_to_reproduce,impact,proof_of_concept
optional-fields: cvss_vector,cvss_score,remediation,affected_users,discovered_at,researcher_notes
required-sections: Summary,Steps to Reproduce,Impact,Supporting Material/References
-->
# {{title}}

## Summary
**Severity:** {{severity}}  
**Weakness:** {{vulnerability_class}}  
**Asset:** {{target}}

{{summary}}

## Steps to Reproduce
{{steps_to_reproduce}}

## Impact
{{impact}}

## Supporting Material/References
{{proof_of_concept}}

## Suggested Remediation
{{remediation}}

## CVSS
**Vector:** {{cvss_vector}}  
**Score:** {{cvss_score}}

**Affected users:** {{affected_users}}  
**Discovered at:** {{discovered_at}}

{{researcher_notes}}