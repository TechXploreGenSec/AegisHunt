<!--
platform: synack
variant: generic
version: 1.0.0
required-fields: title,severity,target,vulnerability_class,summary,steps_to_reproduce,impact,proof_of_concept
optional-fields: cvss_vector,cvss_score,remediation,affected_users,discovered_at,researcher_notes
required-sections: Executive Summary,Reproduction Steps,Proof of Concept,Impact,Remediation
-->
# {{title}}

## Executive Summary
**Severity:** {{severity}}  
**Vulnerability class:** {{vulnerability_class}}  
**Target:** {{target}}

{{summary}}

## Reproduction Steps
{{steps_to_reproduce}}

## Proof of Concept
{{proof_of_concept}}

## Impact
{{impact}}

## Remediation
{{remediation}}

## Assessment Details
**CVSS vector:** {{cvss_vector}}  
**CVSS score:** {{cvss_score}}  
**Affected users:** {{affected_users}}  
**Discovered at:** {{discovered_at}}

{{researcher_notes}}