<!--
platform: google-vrp
variant: generic
version: 1.0.0
required-fields: title,severity,target,vulnerability_class,summary,steps_to_reproduce,impact,proof_of_concept
optional-fields: cvss_vector,cvss_score,remediation,affected_users,discovered_at,researcher_notes
required-sections: Issue Summary,Steps to Reproduce,Impact,Proof of Concept,Remediation
-->
# {{title}}

## Issue Summary
**Severity:** {{severity}}  
**Vulnerability type:** {{vulnerability_class}}  
**Affected product or URL:** {{target}}

{{summary}}

## Steps to Reproduce
{{steps_to_reproduce}}

## Impact
{{impact}}

## Proof of Concept
{{proof_of_concept}}

## Remediation
{{remediation}}

## Additional Context
**CVSS vector:** {{cvss_vector}}  
**CVSS score:** {{cvss_score}}  
**Affected users:** {{affected_users}}  
**Discovered at:** {{discovered_at}}

{{researcher_notes}}