<!--
platform: bugcrowd
variant: generic
version: 1.0.0
required-fields: title,severity,target,vulnerability_class,summary,steps_to_reproduce,impact,proof_of_concept
optional-fields: cvss_vector,cvss_score,remediation,affected_users,discovered_at,researcher_notes
required-sections: Summary,Steps to Reproduce,Proof of Concept,Business Impact,Remediation
-->
# {{title}}

## Summary
**Severity:** {{severity}}  
**Vulnerability class:** {{vulnerability_class}}  
**Target:** {{target}}

{{summary}}

## Steps to Reproduce
{{steps_to_reproduce}}

## Proof of Concept
{{proof_of_concept}}

## Business Impact
{{impact}}

## Remediation
{{remediation}}

## CVSS
**Vector:** {{cvss_vector}}  
**Score:** {{cvss_score}}

## Additional Context
**Affected users:** {{affected_users}}  
**Discovered at:** {{discovered_at}}

{{researcher_notes}}