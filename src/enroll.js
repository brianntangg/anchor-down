// Anchor Down: enrolls in your whole YES cart by calling the registration
// endpoints directly, skipping the slow YES front end. This file has the
// enrollment request and Alt+X; timer.js adds the auto-enroll timer and panel.

console.log("Ready to enroll ;)");

var previous_enrollment_time = Date.now();
var enrollment_attempts = 0;

// Alt+X (forwarded by background.js). Presses within 2s of the last attempt
// are ignored because YES flags faster requests.
chrome.runtime.onMessage.addListener(function (message) {
	if(message.command === "toggle-enroll" && (Date.now() - previous_enrollment_time) > 2000){
		enroll();
		previous_enrollment_time = Date.now();
	}
});

// Reads the cart, then sends one enrollment request covering every class in
// it, with waitlist on.
function enroll() {
	console.log('Attempting Enroll!');

	var request = new XMLHttpRequest();
	request.open("GET", "https://more.app.vanderbilt.edu/more/StudentClass!getSavedClasses.action", true);
	request.send(null);
	request.onreadystatechange = function() {
		if (request.readyState == 4){
			// Term code and class numbers come from the cart HTML.
			var parser = new DOMParser();
			var doc = parser.parseFromString(request.responseText, 'text/html');
			var term_input = doc.getElementById('selectedTermCodeHidden');
			cart = doc.getElementById("StudentCartList_div");
			// No cart on the page: it's empty, the login expired, or the request
			// failed. Nothing to enroll.
			if (!term_input || !cart) {
				console.log('No cart found (empty cart, expired login or no connection). Nothing sent.');
				return;
			}
			term_code = term_input.value;
			class_numbers = [];
			classes = cart.getElementsByClassName("classTable");
			for (i = 0; i < classes.length; i++) {

				classInfo = classes[i].getElementsByClassName("left")[0].childNodes;
				className = classInfo[1].innerText + " " + classInfo[3].innerText;

				classSelections = classes[i].getElementsByClassName("classSelection");

				for(j = 0; j<classSelections.length; j++){
					classSelection = classSelections[j];
					sub = classSelection.children;
					for(k = 0; k<sub.length; k++){
						if(sub[k].name && sub[k].name.split(".").length === 2 && sub[k].name.split(".")[1] === "classNumber"){
							class_numbers.push(sub[k].value);
						}
					}
				}
			}

			console.log(term_code);
			console.log(class_numbers);
			if (class_numbers.length === 0) {
				console.log('Cart is empty. Nothing sent.');
				return;
			}
			// One classNumber/waitList pair per class.
			register_url = 'https://more.app.vanderbilt.edu/more/StudentClass!queueEnroll.action?selectedTermCode=' + term_code;
			for(i = 0; i < class_numbers.length; i++){
				register_url += '&enrollmentRequestItems%5B'+String(i)+'%5D.classNumber=' + class_numbers[i] + '&enrollmentRequestItems%5B'+String(i)+'%5D.waitList=true';
			}

			// Submit, then check the queued job's status once.
			fetch(register_url)
			.then(data=>{return data.json()})
			.then(response=>{
				job_id = response.jobId;
				console.log('Submitted Job: ' + job_id)
				fetch('https://more.app.vanderbilt.edu/more/StudentClass!checkStatus.action?jobId='+job_id)
				.then(data=>{return data.json()})
				.then(response=>{
					if(response){
						console.log('Job Processed');
					}else{
						console.log('Job NOT Processed');
					}
				})
				.catch(function (error) { console.log('Could not check the job status:', error.message); });
			})
			.catch(function (error) { console.log('Enroll request failed:', error.message); });
		}
	};
	fixEnrollmentNumbers();
}

// Updates the hours shown on the page and the attempt counter.
function fixEnrollmentNumbers() {
	fetch('https://more.app.vanderbilt.edu/more/StudentClass!getClassHoursSummary.action')
	.then(data=>{return data.json()})
	.then(response=>{
		document.getElementById('enrolledHours').innerText = response.enrolled.classHours;
		document.getElementById('savedHours').innerText = response.saved.classHours;
		document.getElementById('waitingHours').innerText = response.waitlisted.classHours;
		enrollment_attempts++;
		document.getElementById('enrollmentDatesLink').innerText = 'Attempts: ' + enrollment_attempts;
	})
	.catch(function (error) { console.log('Could not refresh the hours:', error.message); });
}
